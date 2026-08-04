#!/usr/bin/env node
// Dice-visibility probe for dicefall (req 06).
// Quantifies "dice blend into the background": renders the game headless,
// samples screenshot patches at occupied-cell screen positions vs empty-cell
// (bare board) positions, and reports the luminance separation + pip contrast.
//
// Usage: server on :8000, then: node scripts/verify-dice-visibility.js
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
  await new Promise(r => setTimeout(r, 2500)); // let dice rise + settle

  const cells = await page.evaluate(() => {
    const s = window.autoGameState; const m = s.matrix;
    const occ = [], empty = [];
    for (let x = 0; x < s.cols; x++) for (let y = 0; y < s.rows; y++) {
      if (m[x] && m[x][y] && m[x][y].state === 'normal') occ.push([x, y]);
      else if (m[x] && !m[x][y]) empty.push([x, y]);
    }
    // toScreen helper using gridToScreen hook
    const to = (c) => { const p = window.gridToScreen(c[0], c[1]); return { x: p.x, y: p.y }; };
    return { occ: occ.slice(0, 8).map(to), empty: empty.slice(0, 6).map(to) };
  });

  const shot = await page.screenshot({ type: 'png' });
  const { PNG } = require('/home/kolslorr/workspace/devil-dice/node_modules/pngjs');
  const img = PNG.sync.read(shot);

  function lumAt(cx, cy, r) {
    // mean luminance over a patch around (cx,cy); r = half-size
    // bodyLum excludes greenish pip pixels so the die BODY (not the pips)
    // is isolated — the "translucent silhouette" complaint.
    let sum = 0, n = 0, greenish = 0, bodySum = 0, bodyN = 0;
    const R = Math.round(r || 8);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const x = Math.round(cx + dx), y = Math.round(cy + dy);
      if (x < 0 || x >= img.width || y < 0 || y >= img.height) continue;
      const i = (y * img.width + x) * 4;
      const rr = img.data[i], g = img.data[i+1], b = img.data[i+2];
      const lum = 0.2126*rr + 0.7152*g + 0.0722*b;
      sum += lum;
      const isPip = (g > 90 && g > rr * 1.6 && g > b * 1.2);
      if (isPip) greenish++;
      else { bodySum += lum; bodyN++; }
      n++;
    }
    return { lum: n ? sum / n : 0, bodyLum: bodyN ? bodySum / bodyN : 0, greenFrac: n ? greenish / n : 0 };
  }

  let dieLums = [], dieBodies = [], boardLums = [], dieGreen = 0, dieSamples = 0;
  for (const c of cells.occ) {
    const s = lumAt(c.x, c.y);
    dieLums.push(s.lum); dieBodies.push(s.bodyLum); dieGreen += s.greenFrac; dieSamples++;
  }
  for (const c of cells.empty) boardLums.push(lumAt(c.x, c.y).lum);

  const dieAvg = dieLums.reduce((a,b)=>a+b,0)/dieLums.length;
  const bodyAvg = dieBodies.reduce((a,b)=>a+b,0)/dieBodies.length;
  const boardAvg = boardLums.reduce((a,b)=>a+b,0)/boardLums.length;
  const sep = dieAvg / Math.max(1, boardAvg);
  const bodySep = bodyAvg / Math.max(1, boardAvg);

  console.log(`die patches (n=${dieLums.length}): lum avg ${dieAvg.toFixed(1)} | BODY lum avg ${bodyAvg.toFixed(1)}`);
  console.log(`board patches (n=${boardLums.length}): lum avg ${boardAvg.toFixed(1)}`);
  console.log(`die/board separation: ${sep.toFixed(2)}x | BODY/board separation: ${bodySep.toFixed(2)}x`);
  console.log(`pip green presence in die patches: ${(100*dieGreen/dieSamples).toFixed(1)}%`);
  console.log(`[check] BODY separation > 1.4x: ${bodySep > 1.4 ? 'PASS' : 'FAIL'}  (req 06: die body must clearly separate from board)`);
  console.log('[errors]', errors.length ? errors.slice(0,5) : 'none');
  await browser.close();
})().catch(e => { console.log('[fatal]', e.message.slice(0,300)); process.exit(1); });
