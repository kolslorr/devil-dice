#!/usr/bin/env node
// Hold-drag gesture probe for dicefall (user: "drag and drop regressed, top-left buggy").
// Hold-drag = pointerdown -> wait >200ms (hold engages) -> drag to adjacent cell -> die SLIDES.
// Tests: N/S/E/W orthogonal drags + the NW diagonal path (the complaint).
// Also counts pointercancel (mobile browser gesture hijack would show here).
const puppeteer = require('/home/kolslorr/workspace/devil-dice/node_modules/puppeteer');

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox','--disable-gpu','--use-gl=angle','--use-angle=swiftshader'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 450, height: 850 });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0,120)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0,120)); });
  await page.evaluate(() => { window.__pc = 0; document.addEventListener('pointercancel', () => { window.__pc = (window.__pc||0)+1; }); });

  // Initial load + start (probe restarts use quitToMenu/startGame afterwards)
  await page.goto('http://localhost:8000/?seed=20260802', { waitUntil: 'load', timeout: 20000 });
  await page.waitForSelector('#zen-btn', { timeout: 8000 }).catch(()=>{});
  await page.click('#zen-btn').catch(()=>{});
  await new Promise(r => setTimeout(r, 1800));

  async function startGame() {
    // Restart via the game's own globals — avoids page reload flakiness
    // (autoGameState getter throws pre-game; reload timing is unreliable).
    await page.evaluate(() => {
      try { if (typeof quitToMenu === 'function') quitToMenu(); } catch (e) {}
      try { if (typeof startGame === 'function') startGame('zen'); } catch (e) {}
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 1200));
    // Wait until the game is actually playing (dice risen, state readable)
    await page.waitForFunction(() => {
      try { const s = window.autoGameState; return s && s.gameState === 'playing' && s.matrix; }
      catch (e) { return false; }
    }, { timeout: 10000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 200));
  }

  // Find a normal die with a free orthogonal neighbor in `dir` (or the diagonal pair)
  const safeState = () => page.evaluate(() => {
    try { const s = window.autoGameState; return (s && s.matrix) ? { matrix: s.matrix, cols: s.cols, rows: s.rows, gameState: s.gameState } : null; }
    catch (e) { return null; }
  });
  const findDie = (dx, dy) => page.evaluate((dx, dy) => {
    try {
      const s = window.autoGameState; if (!s || !s.matrix || s.gameState !== 'playing') return null;
      const m = s.matrix;
      for (let y = 0; y < s.rows; y++) for (let x = 0; x < s.cols; x++) {
        if (m[x][y] && m[x][y].type === 1 && m[x][y].state === 'normal') {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= s.cols || ny < 0 || ny >= s.rows) continue;
          if (!m[nx][ny]) return { gx: x, gy: y, nx, ny };
        }
      }
    } catch (e) { return { err: e.message }; }
    return null;
  }, dx, dy);

  const cellAt = (x, y) => page.evaluate((x, y) => {
    try { const s = window.autoGameState; return !!(s && s.matrix && s.matrix[x] && s.matrix[x][y]); }
    catch (e) { return false; }
  }, x, y);

  async function holdDrag(fromCell, toScreen, holdMs, paceMs) {
    const from = await page.evaluate((x,y) => window.gridToScreen(x,y), fromCell[0], fromCell[1]);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down({ button: 'left' });
    await new Promise(r => setTimeout(r, holdMs || 320)); // > HOLD_THRESHOLD 200ms
    // Paced drag: ~60ms per step lets chained slides animate between steps
    // (real-user cadence). fastMode: single jump (synthetic, for orthogonal).
    if (paceMs && paceMs > 0) {
      for (let i = 1; i <= 8; i++) {
        const px = from.x + (toScreen.x - from.x) * i / 8;
        const py = from.y + (toScreen.y - from.y) * i / 8;
        await page.mouse.move(px, py);
        await new Promise(r => setTimeout(r, paceMs));
      }
    } else {
      await page.mouse.move(toScreen.x, toScreen.y, { steps: 8 });
    }
    await new Promise(r => setTimeout(r, 400)); // let slide(s) finish
    await page.mouse.up({ button: 'left' });
    await new Promise(r => setTimeout(r, 250));
  }

  let pass = 0, fail = 0;
  const dirs = { north: [0,-1], south: [0,1], east: [1,0], west: [-1,0] };
  for (const [name, [dx, dy]] of Object.entries(dirs)) {
    await startGame();
    const st = await safeState();
    const die = await findDie(dx, dy);
    if (!st || !st.matrix) console.log(`[diag] ${name}: state not ready`, st ? st.gameState : 'null');
    if (die && die.err) console.log(`[diag] ${name}: findDie err ${die.err}`);
    if (!die || die.gx === undefined) { console.log(`[skip] ${name}: no suitable die (state=${st&&st.gameState})`); continue; }
    const tgt = await page.evaluate((x,y) => window.gridToScreen(x,y), die.nx, die.ny);
    await holdDrag([die.gx, die.gy], tgt);
    const srcEmpty = !(await cellAt(die.gx, die.gy));
    const tgtFilled = await cellAt(die.nx, die.ny);
    const ok = srcEmpty && tgtFilled;
    if (ok) pass++; else fail++;
    console.log(`[${ok?'PASS':'FAIL'}] hold-drag ${name} (${die.gx},${die.gy})->(${die.nx},${die.ny}): src empty=${srcEmpty} tgt filled=${tgtFilled}`);
  }

  // NW diagonal: die with free north AND west, drag straight to the (x-1,y-1) screen pos
  await startGame();
  const diag = await page.evaluate(() => {
    try {
      const s = window.autoGameState; if (!s || !s.matrix || s.gameState !== 'playing') return null;
      const m = s.matrix;
      for (let y = 1; y < s.rows; y++) for (let x = 1; x < s.cols; x++) {
        if (m[x][y] && m[x][y].type === 1 && m[x][y].state === 'normal' && !m[x-1][y-1] && !m[x-1][y] && !m[x][y-1]) {
          return { gx: x, gy: y };
        }
      }
    } catch (e) { return { err: e.message }; }
    return null;
  });
  if (diag) {
    const end = await page.evaluate((x,y) => window.gridToScreen(x-1,y-1), diag.gx, diag.gy);
    const before = await page.evaluate((x,y) => { try { const s=window.autoGameState; return { gx:x, gy:y, here:!!(s.matrix[x]&&s.matrix[x][y]) }; } catch(e){ return {err:e.message}; } }, diag.gx, diag.gy);
    await holdDrag([diag.gx, diag.gy], end, 320, 60);
    const after = await page.evaluate((x,y) => {
      const s=window.autoGameState;
      const pos=[];
      for (let yy=0; yy<s.rows; yy++) for (let xx=0; xx<s.cols; xx++) if (s.matrix[xx]&&s.matrix[xx][yy]) pos.push([xx,yy]);
      return pos;
    });
    const srcStill = await cellAt(diag.gx, diag.gy);
    const atNW = await cellAt(diag.gx-1, diag.gy-1);
    console.log(`[diag] NW drag from (${diag.gx},${diag.gy}) -> end at NW cell? ${atNW} | src still occupied: ${srcStill}`);
    console.log(`[diag] dice now at: ${JSON.stringify(after)}`);
  } else {
    console.log('[diag] no die with free N+W+NW; skipped');
  }

  // Touch hold-drag (user is on touch): does it behave? pointercancel count?
  await startGame();
  const tdie = await findDie(0, 1); // south
  if (tdie) {
    const from = await page.evaluate((x,y) => window.gridToScreen(x,y), tdie.gx, tdie.gy);
    const to = await page.evaluate((x,y) => window.gridToScreen(x,y), tdie.nx, tdie.ny);
    const client = await page.createCDPSession();
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
    await new Promise(r => setTimeout(r, 320));
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: to.x, y: to.y }] });
    await new Promise(r => setTimeout(r, 350));
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await new Promise(r => setTimeout(r, 250));
    const srcEmpty = !(await cellAt(tdie.gx, tdie.gy));
    const tgtFilled = await cellAt(tdie.nx, tdie.ny);
    const pc = await page.evaluate(() => window.__pc || 0);
    console.log(`[touch] hold-drag south: src empty=${srcEmpty} tgt filled=${tgtFilled} pointercancel=${pc} -> ${srcEmpty&&tgtFilled?'PASS':'FAIL'}`);
  }

  console.log('[result] orthogonal PASS:', pass, 'FAIL:', fail);
  console.log('[errors]', errors.length ? errors.slice(0,5) : 'none');
  await browser.close();
})().catch(e => { console.log('[fatal]', e.message.slice(0,300)); process.exit(1); });
