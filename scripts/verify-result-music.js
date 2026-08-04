#!/usr/bin/env node
// Req 14 verification: victory/defeat music transitions.
// 1. win.mp3/lose.mp3 fetchable; sw.js v4 precaches them
// 2. Puzzle stage clear -> music transits to 'win', then back to 'puzzle'
//    after auto-advance (req 13/14 integration)
// 3. AudioEngine.playVictory/playDefeat swap tracks on the music bus
// 4. triggerGameOver branches: battle win -> win, battle lose -> lose,
//    puzzle all-cleared -> win, puzzle out-of-moves -> lose, zen fill -> lose
const puppeteer = require('/home/kolslorr/workspace/devil-dice/node_modules/puppeteer');

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 450, height: 850 });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });

  let pass = 0, fail = 0;
  const check = (ok, label, extra) => { if (ok) pass++; else fail++; console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${extra ? ' — ' + extra : ''}`); };
  const waitFor = async (fn, timeout) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { try { if (await fn()) return true; } catch (e) {} await new Promise(r => setTimeout(r, 60)); } return false; };
  const audioState = () => page.evaluate(() => {
    const out = { active: window.activeMusicMode || null, ctx: window.audioCtx ? window.audioCtx.state : 'none' };
    out.els = {};
    for (const k in window.musicElements || {}) { const el = window.musicElements[k]; out.els[k] = { paused: el.paused, t: +el.currentTime.toFixed(1) }; }
    return out;
  });

  await page.goto('http://localhost:8000/?seed=20260802', { waitUntil: 'load', timeout: 20000 });
  await page.waitForSelector('#puzzle-btn', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 800));

  // 1. files + sw.js
  for (const f of ['audio/win.mp3', 'audio/lose.mp3']) {
    const s = await page.evaluate(async f => { try { return (await fetch(f)).status; } catch (e) { return 'ERR'; } }, f);
    check(s === 200, `fetch ${f} -> ${s}`);
  }
  const sw = await page.evaluate(async () => (await (await fetch('/sw.js')).text()));
  check(/devildice-v4/.test(sw), 'sw.js cache = devildice-v4');
  check(sw.includes('audio/win.mp3') && sw.includes('audio/lose.mp3'), 'sw.js precaches win/lose tracks');

  // 2. puzzle stage clear -> win -> puzzle
  await page.evaluate(() => { window.ROLL_DURATION = 80; window.SLIDE_DURATION = 80; window.SINK_DURATION = 150; });
  await page.click('#puzzle-btn');
  await new Promise(r => setTimeout(r, 400));
  await page.click('#puzzle-resume-btn');
  await new Promise(r => setTimeout(r, 800));
  // replay stage 1 solution (1 move)
  const sol = await page.evaluate(() => window.PUZZLE_STAGES[0].solution);
  await page.evaluate((mv) => {
    const d = grid[mv.x] && grid[mv.x][mv.y] ? grid[mv.x][mv.y] : null;
    if (d) window.triggerRoll(d, mv.dir);
  }, sol[0]);
  // after clear: banner -> win track
  const sawWin = await waitFor(async () => (await audioState()).active === 'win', 4000);
  check(sawWin, 'puzzle stage clear -> music transits to WIN track');
  // auto-advance -> puzzle track resumes
  const backToPuzzle = await waitFor(async () => (await audioState()).active === 'puzzle', 6000);
  check(backToPuzzle, 'after auto-advance, puzzle track resumes', JSON.stringify(await audioState()));

  // 3. direct transitions
  await page.evaluate(() => AudioEngine.playVictory());
  await new Promise(r => setTimeout(r, 900));
  let st = await audioState();
  check(st.active === 'win' && st.els.win && !st.els.win.paused && st.els.win.t > 0.3, 'playVictory plays win track', JSON.stringify(st));
  await page.evaluate(() => AudioEngine.playDefeat());
  await new Promise(r => setTimeout(r, 900));
  st = await audioState();
  check(st.active === 'lose' && st.els.lose && !st.els.lose.paused && st.els.lose.t > 0.3, 'playDefeat plays lose track', JSON.stringify(st));
  const winPaused = st.els.win && st.els.win.paused;
  check(winPaused, 'defeat crossfade pauses the win track');

  // 4. triggerGameOver branches
  const go = (mode, playerWon, puzzleClearedFlag) => page.evaluate(({ mode, playerWon, puzzleClearedFlag }) => {
    gameState = 'playing'; gameMode = mode; puzzleCleared = puzzleClearedFlag;
    if (mode === 'battle') { battlePlayerScore = playerWon ? 100 : 10; battleAiScore = playerWon ? 50 : 200; }
    triggerGameOver();
  }, { mode, playerWon, puzzleClearedFlag });

  await go('battle', true, false); await new Promise(r => setTimeout(r, 900));
  check((await audioState()).active === 'win', 'battle WIN -> win track');
  await go('battle', false, false); await new Promise(r => setTimeout(r, 900));
  check((await audioState()).active === 'lose', 'battle LOSE -> lose track');
  await go('puzzle', false, true); await new Promise(r => setTimeout(r, 900));
  check((await audioState()).active === 'win', 'puzzle ALL CLEARED -> win track');
  await go('puzzle', false, false); await new Promise(r => setTimeout(r, 900));
  check((await audioState()).active === 'lose', 'puzzle OUT OF MOVES -> lose track');
  await go('zen', false, false); await new Promise(r => setTimeout(r, 900));
  check((await audioState()).active === 'lose', 'zen board-filled -> lose track');

  console.log(`[result] PASS: ${pass} FAIL: ${fail}`);
  console.log('[errors]', errors.length ? errors.slice(0, 10) : 'none');
  await browser.close();
})().catch(e => { console.log('[fatal]', e.message.slice(0, 300)); process.exit(1); });
