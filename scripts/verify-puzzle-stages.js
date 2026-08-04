#!/usr/bin/env node
// Req 12 verification: replays every stage's embedded solution in the REAL game
// (headless Chrome). Gate: 50/50 stages must clear the board within budget.
// Also smoke-tests the stage-select UI and progression persistence.
const puppeteer = require('/home/kolslorr/workspace/devil-dice/node_modules/puppeteer');
const fs = require('fs');
const vm = require('vm');

// ── Variety audit (data-level, fails fast) ──
(function auditVariety() {
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('/home/kolslorr/workspace/devil-dice/puzzle-stages.js', 'utf8'), ctx);
  const S = ctx.PUZZLE_STAGES;
  if (!Array.isArray(S) || S.length !== 50) throw new Error('PUZZLE_STAGES must have 50 entries, got ' + (S && S.length));
  let pass = 0, fail = 0;
  const check = (ok, label, extra) => { if (ok) pass++; else fail++; console.log(`[${ok ? 'PASS' : 'FAIL'}] VARIETY: ${label}${extra ? ' — ' + extra : ''}`); };

  const sigs = new Set();
  let dupes = [];
  S.forEach((s, i) => {
    const diceSig = s.dice.map(d => `${d.x},${d.y},${d.v},${d.rot}`).sort().join('|');
    const wallSig = (s.walls || []).map(w => `${w.x},${w.y}`).sort().join('|');
    const moveSig = s.solution.map(m => (m.type || 'roll') + m.dir).join('|');
    const sig = `${s.board.cols}x${s.board.rows}#${diceSig}#${wallSig}#${moveSig}`;
    if (sigs.has(sig)) dupes.push(i + 1); sigs.add(sig);
  });
  check(dupes.length === 0, 'all 50 stages pairwise-distinct', dupes.length ? 'dupes at: ' + dupes.join(',') : '');

  const values = new Set(S.flatMap(s => s.dice.map(d => d.v)));
  check([1, 2, 3, 4, 5, 6].every(v => values.has(v)), 'every face value 1-6 appears', [...values].sort().join(','));

  const slideStages = S.filter(s => s.solution.some(m => m.type === 'slide')).length;
  check(slideStages >= 12, `>= 12 stages use a slide step`, `${slideStages} stages`);

  const slideSteps = S.reduce((n, s) => n + s.solution.filter(m => m.type === 'slide').length, 0);

  let sameBoardAdj = 0;
  for (let i = 1; i < S.length; i++) if (S[i].board.cols === S[i - 1].board.cols && S[i].board.rows === S[i - 1].board.rows) sameBoardAdj++;
  check(sameBoardAdj === 0, 'no two adjacent stages share the same board size', `${sameBoardAdj} adjacent dupes`);

  const boardsUsed = new Set(S.map(s => `${s.board.cols}x${s.board.rows}`));
  check(boardsUsed.size >= 4, '>= 4 distinct board sizes used', [...boardsUsed].join(','));

  const multiValued = S.filter(s => new Set(s.dice.map(d => d.v)).size >= 2).length;
  check(multiValued >= 20, '>= 20 stages have 2+ different face values', `${multiValued} stages`);

  const wallStages = S.filter(s => (s.walls || []).length > 0).length;
  check(wallStages >= 15, '>= 15 stages use walls', `${wallStages} stages`);

  // budget/solution margin sanity
  const marginOk = S.every(s => s.solution.length <= s.moves && s.moves - s.solution.length >= 1);
  check(marginOk, 'every stage: solution <= budget with >= 1 margin');

  // value variety within early bands (user complaint: stages 1-5/6-10 all same)
  const early = S.slice(0, 10);
  const earlyValues = new Set(early.flatMap(s => s.dice.map(d => d.v)));
  check(earlyValues.size >= 4, `stages 1-10 use >= 4 distinct values`, [...earlyValues].join(','));

  console.log(`[variety-audit] PASS: ${pass} FAIL: ${fail} (${slideSteps} slide steps total)`);
  if (fail) throw new Error('Variety audit failed — do not proceed to replay.');
})();

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 450, height: 850 });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });

  // Neutralize the win-branch auto-advance timer (setMusic/win branch schedules
  // setupPuzzleStage via setTimeout — 1800ms in req 12, 2200ms after req 14).
  // Capture ALL setTimeouts and clear them before each stage, otherwise a stale
  // timer from a cleared stage resets the NEXT stage mid-replay.
  await page.evaluateOnNewDocument(() => {
    window.__probeTimers = [];
    const _st = window.setTimeout.bind(window);
    window.setTimeout = function (fn, ms) {
      const id = _st(fn, ms);
      window.__probeTimers.push(id);
      return id;
    };
    window.__probeClearTimers = function () { window.__probeTimers.forEach(id => clearTimeout(id)); window.__probeTimers = []; };
  });

  await page.goto('http://localhost:8000/?seed=20260802', { waitUntil: 'load', timeout: 20000 });
  await page.waitForSelector('#puzzle-btn', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 800));

  let pass = 0, fail = 0;
  const check = (ok, label, extra) => { if (ok) pass++; else fail++; console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${extra ? ' — ' + extra : ''}`); };

  // ── UI smoke: stage select screen ──
  await page.click('#puzzle-btn');
  await new Promise(r => setTimeout(r, 400));
  const ui = await page.evaluate(() => ({
    selectActive: document.getElementById('puzzle-select-screen').classList.contains('active'),
    tileCount: document.querySelectorAll('.puzzle-tile').length,
    lockedCount: document.querySelectorAll('.puzzle-tile.locked').length,
    resumeText: document.getElementById('puzzle-resume-btn').innerText,
    progressText: document.getElementById('puzzle-select-progress').innerText,
  }));
  check(ui.selectActive, 'puzzle-btn opens stage select screen');
  check(ui.tileCount === 50, '50 tiles rendered', `got ${ui.tileCount}`);
  check(ui.lockedCount === 49, 'fresh profile: 49 locked (only stage 1 unlocked)', `locked ${ui.lockedCount}`);
  check(ui.resumeText === 'RESUME STAGE 1', 'resume button = RESUME STAGE 1', ui.resumeText);

  // Enter via the resume button (real UI path)
  await page.click('#puzzle-resume-btn');
  await new Promise(r => setTimeout(r, 800));
  const st = await page.evaluate(() => ({
    state: window.autoGameState.gameState, mode: window.autoGameState.gameMode,
    stage: document.getElementById('puzzle-stage').innerText, cols: GRID_COLS, rows: GRID_ROWS,
  }));
  check(st.state === 'playing' && st.mode === 'puzzle', 'resume button starts puzzle mode');
  check(st.stage === 'STAGE 1/50', 'HUD stage label', st.stage);

  // Speed up animations — logic-only replay (globals are looked up at call time)
  await page.evaluate(() => { window.ROLL_DURATION = 80; window.SLIDE_DURATION = 80; window.SINK_DURATION = 150; });

  const total = await page.evaluate(() => window.PUZZLE_STAGES.length);
  const waitFor = async (fn, timeout) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { try { if (await fn()) return true; } catch (e) {} await new Promise(r => setTimeout(r, 40)); } return false; };

  const fails = [];
  let cleared = 0, totalMoves = 0;
  const t0 = Date.now();
  for (let s = 1; s <= total; s++) {
    await page.evaluate((n) => { window.__probeClearTimers(); window.puzzleStage = n; window.setupPuzzleStage(); }, s);
    await new Promise(r => setTimeout(r, 150));
    const stage = await page.evaluate((n) => {
      const def = window.PUZZLE_STAGES[n - 1];
      function countWalls() { let w = 0; for (let x = 0; x < GRID_COLS; x++) for (let y = 0; y < GRID_ROWS; y++) { const d = grid[x][y]; if (d && d.cellType === CELL_TYPE.LOCKED) w++; } return w; }
      let dice = 0; const tops = [];
      for (let x = 0; x < GRID_COLS; x++) for (let y = 0; y < GRID_ROWS; y++) { const d = grid[x][y]; if (d && d.cellType !== CELL_TYPE.LOCKED) { dice++; tops.push(d.faces.top); } }
      return {
        moves: window.puzzleMovesRemaining, expMoves: def.moves, expDice: def.dice.length, expWalls: def.walls.length,
        walls: countWalls(), dice,
        tops: tops.slice().sort((a, b) => a - b).join(','),
        expTops: def.dice.map(d => d.v).slice().sort((a, b) => a - b).join(','),
        cols: GRID_COLS, rows: GRID_ROWS, expCols: def.board.cols, expRows: def.board.rows, solLen: def.solution.length,
      };
    }, s);
    const layoutOk = stage.dice === stage.expDice && stage.walls === stage.expWalls && stage.tops === stage.expTops &&
      stage.cols === stage.expCols && stage.rows === stage.expRows && stage.moves === stage.expMoves;
    if (!layoutOk) { check(false, `stage ${s} layout`, JSON.stringify(stage)); fails.push(s); continue; }

    const sol = await page.evaluate((n) => window.PUZZLE_STAGES[n - 1].solution, s);
    totalMoves += sol.length;
    let stepErr = null, blockedSteps = 0;
    for (let i = 0; i < sol.length; i++) {
      const mv = sol[i];
      const r = await page.evaluate((mv) => {
        const d = grid[mv.x] && grid[mv.x][mv.y] ? grid[mv.x][mv.y] : null;
        if (!d || d.cellType === CELL_TYPE.LOCKED) return { err: 'no-die' };
        if (d.state !== 'normal') return { err: 'state-' + d.state };
        window.__probeDie = d;
        if (mv.type === 'slide') window.triggerSlide(d, mv.dir);
        else window.triggerRoll(d, mv.dir);
        return { ok: true };
      }, mv);
      if (r.err) { stepErr = `${i + 1}:${r.err}`; break; }
      const anim = await waitFor(async () => page.evaluate(() => window.animationLock === false && window.activeSinkingGroups.length === 0), 5000);
      if (!anim) { stepErr = `${i + 1}:anim-timeout`; break; }
      const pos = await page.evaluate(() => { const d = window.__probeDie; return d ? d.gridX + ',' + d.gridY : 'gone'; });
      if (pos === mv.x + ',' + mv.y) blockedSteps++;
      await new Promise(r => setTimeout(r, 60));
    }
    await waitFor(async () => page.evaluate(() => window.countPuzzleRemaining() === 0), 5000);
    const remaining = await page.evaluate(() => window.countPuzzleRemaining());
    const ok2 = remaining === 0 && !stepErr;
    if (ok2) cleared++;
    check(ok2, `stage ${s} (${stage.expDice}d, budget ${stage.expMoves}, sol ${stage.solLen})`, stepErr || (blockedSteps ? `blocked ${blockedSteps} steps, remaining ${remaining}` : 'cleared'));
    if (!ok2) fails.push(s);
  }
  const elapsed = Math.round((Date.now() - t0) / 1000);

  // ── Progression persistence + UI state after full clear ──
  await page.evaluate(() => { try { window.quitToMenu(); } catch (e) {} });
  await new Promise(r => setTimeout(r, 500));
  await page.click('#puzzle-btn');
  await new Promise(r => setTimeout(r, 400));
  const prog = await page.evaluate(() => ({
    progressText: document.getElementById('puzzle-select-progress').innerText,
    resumeText: document.getElementById('puzzle-resume-btn').innerText,
    solved: document.querySelectorAll('.puzzle-tile.solved').length,
    locked: document.querySelectorAll('.puzzle-tile.locked').length,
    progress: window.puzzleProgress,
  }));
  check(prog.progress === total, `progression saved to localStorage (${prog.progress}/${total})`);
  check(prog.solved === total && prog.locked === 0, 'stage select: all tiles solved after full clear', `solved ${prog.solved}`);
  check(/ALL 50 STAGES CLEARED/.test(prog.progressText), 'select screen shows ALL CLEARED', prog.progressText);

  console.log(`[result] PASS: ${pass} FAIL: ${fail} — stages cleared ${cleared}/${total}, ${totalMoves} solution moves, ${elapsed}s`);
  if (fails.length) console.log('[fails] stages:', fails.join(','));
  console.log('[errors]', errors.length ? errors.slice(0, 10) : 'none');
  await browser.close();
})().catch(e => { console.log('[fatal]', e.message.slice(0, 300)); process.exit(1); });
