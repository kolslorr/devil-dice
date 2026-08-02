#!/usr/bin/env node
// Blocked-by-dice probe for devil-dice (req 08: match original rules).
// The OLD behavior: hold-dragging a die into an occupied cell pushed the whole
// lane forward (chain drag). The ORIGINAL behavior: the die is BLOCKED — no
// movement at all. This probe verifies:
//   1. hold-drag into an occupied cell -> die does NOT move, neighbor does NOT move
//   2. hold-drag into an EMPTY cell still works (regression)
//   3. flick into an occupied cell -> blocked (roll already handled this)
// Uses quitToMenu/startGame restarts (reload is flaky with autoGameState).
const puppeteer = require('/home/kolslorr/workspace/devil-dice/node_modules/puppeteer');

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox','--disable-gpu','--use-gl=angle','--use-angle=swiftshader'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 450, height: 850 });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0,120)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0,120)); });

  await page.goto('http://localhost:8000/?seed=20260802', { waitUntil: 'load', timeout: 20000 });
  await page.waitForSelector('#zen-btn', { timeout: 8000 }).catch(()=>{});
  await page.click('#zen-btn').catch(()=>{});
  await new Promise(r => setTimeout(r, 1800));

  async function startGame() {
    await page.evaluate(() => {
      try { if (typeof quitToMenu === 'function') quitToMenu(); } catch (e) {}
      try { if (typeof startGame === 'function') startGame('zen'); } catch (e) {}
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 1200));
    await page.waitForFunction(() => {
      try { const s = window.autoGameState; return s && s.gameState === 'playing' && s.matrix; }
      catch (e) { return false; }
    }, { timeout: 10000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 200));
  }

  const occAt = (x, y) => page.evaluate((x, y) => {
    try { const s = window.autoGameState; return !!(s && s.matrix && s.matrix[x] && s.matrix[x][y]); }
    catch (e) { return false; }
  }, x, y);

  // Find: die at (x,y) with an OCCUPIED neighbor at (nx,ny) that has an EMPTY cell
  // beyond it in the same direction (the exact old chain-push scenario).
  const findPushScenario = () => page.evaluate(() => {
    try {
      const s = window.autoGameState; if (!s || !s.matrix) return null;
      const m = s.matrix;
      const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
      for (let y = 0; y < s.rows; y++) for (let x = 0; x < s.cols; x++) {
        const die = m[x][y];
        if (!die || die.type !== 1 || die.state !== 'normal') continue;
        for (const [dx, dy] of dirs) {
          const nx = x+dx, ny = y+dy;
          if (nx < 0 || nx >= s.cols || ny < 0 || ny >= s.rows) continue;
          if (!m[nx][ny]) continue; // needs an occupied neighbor
          const bx = nx+dx, by = ny+dy;
          if (bx < 0 || bx >= s.cols || by < 0 || by >= s.rows) continue;
          if (m[bx][by]) continue; // needs empty beyond (old push would move both)
          return { gx: x, gy: y, nx, ny, bx, by };
        }
      }
    } catch (e) { return { err: e.message }; }
    return null;
  });

  // Hold-drag from a cell toward a target screen position
  async function holdDrag(from, toScreen) {
    const f = await page.evaluate((x,y) => window.gridToScreen(x,y), from[0], from[1]);
    await page.mouse.move(f.x, f.y);
    await page.mouse.down({ button: 'left' });
    await new Promise(r => setTimeout(r, 320));
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(f.x + (toScreen.x - f.x) * i / 6, f.y + (toScreen.y - f.y) * i / 6);
      await new Promise(r => setTimeout(r, 40));
    }
    await new Promise(r => setTimeout(r, 350));
    await page.mouse.up({ button: 'left' });
    await new Promise(r => setTimeout(r, 250));
  }

  let pass = 0, fail = 0;
  // Test 1: hold-drag into occupied cell -> BLOCKED (both stay)
  await startGame();
  const sc = await findPushScenario();
  if (sc && !sc.err) {
    const tgt = await page.evaluate((x,y) => window.gridToScreen(x,y), sc.nx, sc.ny);
    const before = { src: await occAt(sc.gx, sc.gy), nbr: await occAt(sc.nx, sc.ny), beyond: await occAt(sc.bx, sc.by) };
    await holdDrag([sc.gx, sc.gy], tgt);
    const after = { src: await occAt(sc.gx, sc.gy), nbr: await occAt(sc.nx, sc.ny), beyond: await occAt(sc.bx, sc.by) };
    const blocked = before.src && after.src && before.nbr && after.nbr && !after.beyond;
    if (blocked) pass++; else fail++;
    console.log(`[${blocked?'PASS':'FAIL'}] hold-drag into occupied (${sc.gx},${sc.gy})->(${sc.nx},${sc.ny}): die stayed=${after.src} neighbor stayed=${after.nbr} beyond still empty=${!after.beyond} (no push)`);
  } else {
    console.log('[skip] no push scenario found on this board');
  }

  // Test 2: hold-drag into an EMPTY cell still works
  await startGame();
  const free = await page.evaluate(() => {
    try {
      const s = window.autoGameState; if (!s || !s.matrix) return null;
      const m = s.matrix;
      const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
      for (let y = 0; y < s.rows; y++) for (let x = 0; x < s.cols; x++) {
        const die = m[x][y];
        if (!die || die.type !== 1 || die.state !== 'normal') continue;
        for (const [dx, dy] of dirs) {
          const nx = x+dx, ny = y+dy;
          if (nx < 0 || nx >= s.cols || ny < 0 || ny >= s.rows) continue;
          if (!m[nx][ny]) return { gx: x, gy: y, nx, ny };
        }
      }
    } catch (e) { return { err: e.message }; }
    return null;
  });
  if (free && !free.err) {
    const tgt = await page.evaluate((x,y) => window.gridToScreen(x,y), free.nx, free.ny);
    await holdDrag([free.gx, free.gy], tgt);
    const ok = !(await occAt(free.gx, free.gy)) && (await occAt(free.nx, free.ny));
    if (ok) pass++; else fail++;
    console.log(`[${ok?'PASS':'FAIL'}] hold-drag into empty (${free.gx},${free.gy})->(${free.nx},${free.ny}): moved=${ok}`);
  } else {
    console.log('[skip] no free-neighbor die found');
  }

  // Test 3: flick (quick swipe) into an occupied cell -> blocked (roll path)
  await startGame();
  const sc2 = await findPushScenario();
  if (sc2 && !sc2.err) {
    const a = await page.evaluate((x,y) => window.gridToScreen(x,y), sc2.gx, sc2.gy);
    const b = await page.evaluate((x,y) => window.gridToScreen(x,y), sc2.nx, sc2.ny);
    const nx = a.x + (b.x - a.x) * 0.6, ny = a.y + (b.y - a.y) * 0.6;
    await page.mouse.move(a.x, a.y);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(nx, ny, { steps: 3 });
    await new Promise(r => setTimeout(r, 30));
    await page.mouse.up({ button: 'left' });
    await new Promise(r => setTimeout(r, 400));
    const dieStayed = await occAt(sc2.gx, sc2.gy);
    const nbrStayed = await occAt(sc2.nx, sc2.ny);
    const beyondEmpty = !(await occAt(sc2.bx, sc2.by));
    const ok = dieStayed && nbrStayed && beyondEmpty;
    if (ok) pass++; else fail++;
    console.log(`[${ok?'PASS':'FAIL'}] flick into occupied (${sc2.gx},${sc2.gy})->(${sc2.nx},${sc2.ny}): die stayed=${dieStayed} neighbor stayed=${nbrStayed} (blocked)`);
  } else {
    console.log('[skip] no push scenario for flick test');
  }

  console.log('[result] PASS:', pass, 'FAIL:', fail);
  console.log('[errors]', errors.length ? errors.slice(0,5) : 'none');
  await browser.close();
})().catch(e => { console.log('[fatal]', e.message.slice(0,300)); process.exit(1); });
