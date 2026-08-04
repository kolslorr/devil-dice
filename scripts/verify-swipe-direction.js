#!/usr/bin/env node
// Swipe/flick direction accuracy probe for dicefall.
// Proves each screen-direction swipe moves the die into the exact grid cell
// the swipe visually points at (camera-aware), using occupancy as ground truth
// (source empties, target fills) — NOT die-tracking (autoGameState returns the
// first active die, which may be a different die after moves).
//
// Usage: start the dev server on :8000 first, then:
//   node scripts/verify-swipe-direction.js
// Requires puppeteer in the project's node_modules.
const puppeteer = require('/home/kolslorr/workspace/devil-dice/node_modules/puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-gpu',
           '--use-gl=angle', '--use-angle=swiftshader']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 450, height: 850 });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 120)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 120)); });

  // NOTE: use waitUntil 'load' — networkidle0 is starved by heavy WebGL on
  // SwiftShader (see references/networkidle0-debugging.md).
  await page.goto('http://localhost:8000/?seed=20260802', { waitUntil: 'load', timeout: 20000 });

  // Find a die whose neighbor in `dir` is empty AND in bounds
  const findDie = (dir) => page.evaluate((dir) => {
    const off = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[dir];
    const s = window.autoGameState;
    if (!s || s.gameState !== 'playing') return { state: s && s.gameState };
    const m = s.matrix;
    for (let y = 0; y < s.rows; y++) for (let x = 0; x < s.cols; x++) {
      if (m[x][y] && m[x][y].type === 1 && m[x][y].state === 'normal') {
        const nx = x + off[0], ny = y + off[1];
        if (nx < 0 || nx >= s.cols || ny < 0 || ny >= s.rows) continue;
        if (!m[nx][ny]) return { gx: x, gy: y, nx, ny };
      }
    }
    return null;
  }, dir);

  const cellAt = (x, y) => page.evaluate((x, y) => {
    const s = window.autoGameState; return !!(s && s.matrix[x] && s.matrix[x][y]);
  }, x, y);

  async function startGame() {
    await page.evaluate(() => { try { window.location.reload(); } catch (e) {} });
    await new Promise(r => setTimeout(r, 1500));
    await page.waitForSelector('#zen-btn', { timeout: 8000 }).catch(() => {});
    await page.click('#zen-btn').catch(() => {});
    await new Promise(r => setTimeout(r, 1500));
  }

  const dirs = ['north', 'south', 'east', 'west'];
  let pass = 0, fail = 0, skip = 0;
  for (const dir of dirs) {
    await startGame();
    const die = await findDie(dir);
    if (!die || die.gx === undefined) { console.log('[skip]', dir, JSON.stringify(die)); skip++; continue; }
    console.log('[test]', dir, 'die at', die.gx, die.gy, '-> target', die.nx, die.ny);

    // gridToScreen hook gives the screen pos of a grid cell; swipe 60% of the
    // way toward the neighbor's screen position (a real flick, <HOLD_THRESHOLD).
    const target = await page.evaluate((x, y) => window.gridToScreen(x, y), die.gx, die.gy);
    const neighbor = await page.evaluate((x, y) => window.gridToScreen(x, y), die.nx, die.ny);
    const nx = target.x + (neighbor.x - target.x) * 0.6;
    const ny = target.y + (neighbor.y - target.y) * 0.6;

    await page.mouse.move(target.x, target.y);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(nx, ny, { steps: 3 });
    await new Promise(r => setTimeout(r, 30));
    await page.mouse.up({ button: 'left' });
    await new Promise(r => setTimeout(r, 500)); // let the roll animation finish

    const srcEmpty = !(await cellAt(die.gx, die.gy));
    const tgtFilled = await cellAt(die.nx, die.ny);
    const ok = srcEmpty && tgtFilled;
    if (ok) pass++; else fail++;
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${dir}: source empty=${srcEmpty} target filled=${tgtFilled}`);
  }
  console.log('[result] PASS:', pass, 'FAIL:', fail, 'SKIP:', skip);
  console.log('[errors]', errors.length ? errors.slice(0, 5) : 'none');
  await browser.close();
})().catch(e => { console.log('[fatal]', e.message.slice(0, 300)); process.exit(1); });
