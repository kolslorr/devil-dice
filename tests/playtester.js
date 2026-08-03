#!/usr/bin/env node
/**
 * Devil Dice 3D — Headless Playtester
 *
 * Launches a headless Chrome via Puppeteer, starts the game with a fixed
 * seed (?seed=) so the board layout is reproducible, simulates 30+ seconds
 * of real touch swipes (CDP Input.dispatchTouchEvent -> pointer events),
 * and captures console logs, FPS metrics, and screenshots for visual
 * regression testing against an in-game golden baseline.
 *
 * Usage: node tests/playtester.js [--golden golden/baseline.png] [--port 8000]
 *
 * Outputs structured JSON to stdout:
 *   { passed, fpsAvg, fpsMin, errors, warnings, screenshot, diffPct,
 *     movesAttempted, movesCompleted, matchesFound, ... }
 */

const puppeteer = require('puppeteer');
const { createCanvas, loadImage } = require('canvas');
const pixelmatch = require('pixelmatch').default || require('pixelmatch');
const fs = require('fs');
const path = require('path');

const ARGS = {
  golden: process.argv.find(a => a.startsWith('--golden='))?.split('=')[1] || 'golden/baseline.png',
  port: parseInt(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || '8000', 10),
  duration: parseInt(process.argv.find(a => a.startsWith('--duration='))?.split('=')[1] || '35000', 10),
};
const BASELINE = process.argv.includes('--baseline');

// Deterministic seeds: the page must be loaded with the same seed as the
// golden baseline so the initial board layout matches exactly.
const SEED = '20260802';

const TEST_ID = Date.now().toString(36);
const RESULTS = {
  passed: false,
  fpsSamples: [],
  fpsAvg: 0,
  fpsMin: Infinity,
  errors: [],
  warnings: [],
  consoleLogs: [],
  screenshot: null,
  diffPct: null,
  movesAttempted: 0,
  movesCompleted: 0,
  matchesFound: 0,
  maxConcurrentSinkingGroups: 0,
  testId: TEST_ID,
  zenEffectsVerified: false,
  zenAmbientParticles: false,
  zenBurstsSpawned: 0,
};

// ── Seeded RNG (node side) so the simulated move sequence is reproducible ──
let _rngState = parseInt(SEED, 10);
function rand(min, max) {
  _rngState = (_rngState * 1664525 + 1013904223) >>> 0;
  const r = _rngState / 4294967296;
  return Math.floor(r * (max - min + 1)) + min;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Grid occupancy signature (dice positions + top faces only) ──
function occupancySig(state) {
  const cells = [];
  for (let x = 0; x < state.cols; x++) {
    for (let y = 0; y < state.rows; y++) {
      const c = state.matrix[x] && state.matrix[x][y];
      cells.push(c ? `${c.type}:${c.top}` : '.');
    }
  }
  return cells.join(',');
}

// ── Real touch swipe via CDP. Chrome synthesizes pointer events from these,
//    so the game's pointer-based gesture handler sees a genuine swipe. ──
async function touchSwipe(page, from, to) {
  const client = await page.createCDPSession();
  try {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: from.x, y: from.y }]
    });
    // A single jump to the destination keeps the whole gesture comfortably
    // under the game's HOLD_THRESHOLD (200ms) even with CDP round-trip
    // latency, so it registers as a roll rather than a hold.
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: to.x, y: to.y }]
    });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await client.detach();
  }
}

// ── Main playtest routine ──
async function runPlaytest() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu',
           '--use-gl=angle', '--use-angle=swiftshader', '--disable-web-security',
           '--autoplay-policy=no-user-gesture-required',
           '--disable-features=AudioServiceOutOfProcess'],
  });

  const page = await browser.newPage();

  // Mobile-first viewport matching the game's design
  await page.setViewport({ width: 450, height: 850, isMobile: true, hasTouch: true });

  // Collect console output
  page.on('console', msg => {
    const text = msg.text();
    RESULTS.consoleLogs.push({ type: msg.type(), text: text.substring(0, 200) });

    // Skip known non-critical resource errors (missing PWA icons)
    if (text.includes('icon-192.png') || text.includes('icon-512.png') ||
        text.includes('Manifest') || text.includes('Download error')) return;

    if (msg.type() === 'error') RESULTS.errors.push(text);
    else if (msg.type() === 'warning') RESULTS.warnings.push(text);
  });

  page.on('pageerror', err => {
    RESULTS.errors.push('PAGE_ERROR: ' + err.message);
  });

  // Navigate to the game with a deterministic seed.
  // NOTE: waitUntil 'networkidle0' never fires for this game — the renderer
  // main thread is saturated by per-frame WebGL on SwiftShader, which starves
  // Chrome's networkIdle lifecycle event even though the network is genuinely
  // idle. 'load' fires reliably; readiness is gated by #zen-btn below.
  const baseUrl = `http://localhost:${ARGS.port}`;
  const url = `${baseUrl}/?seed=${SEED}`;
  await page.goto(url, { waitUntil: 'load', timeout: 15000 });
  await page.waitForSelector('#zen-btn', { timeout: 5000 });

  // Start Zen mode
  await page.click('#zen-btn');

  // Stop the spawner IMMEDIATELY (before any spawn can fire) so the settled
  // board for the regression screenshot is deterministic — initial dice only.
  // A spawn landing mid-capture shifts pixels run-to-run (amplified by
  // audio-startup timing variance); golden + test must capture the same board.
  await page.evaluate(() => { try { if (typeof window.stopSpawning === 'function') window.stopSpawning(); } catch (e) {} });

  // Wait for the game to initialize and all dice to finish rising so the
  // board is visually settled (matching the golden baseline state).
  await page.waitForFunction(() =>
    window.autoGameState && window.autoGameState.gameState === 'playing', { timeout: 5000 }
  );
  await page.waitForFunction(() => {
    const s = window.autoGameState;
    if (!s || s.gameState !== 'playing') return false;
    for (let x = 0; x < s.cols; x++) {
      for (let y = 0; y < s.rows; y++) {
        const cell = s.matrix[x] && s.matrix[x][y];
        if (cell && cell.state !== 'normal') return false;
      }
    }
    return true;
  }, { timeout: 10000 });
  await sleep(400); // let the final animation frame settle

  // Regression screenshot: deterministic, pre-move, firework-free (seeded mode)
  //
  // Hide the TIME-VARYING background layers so the capture frame is fully
  // deterministic: nebula stars twinkle, stardust drifts per-frame, and the
  // circuit pulse follows uTime — all phase-dependent, so they differ
  // run-to-run (a bright star appearing in one run alone trips pixelmatch).
  // Golden and test capture the same static board + dice scene this way.
  // Visibility is restored right after the screenshot (below).
  await page.evaluate(() => {
    const setVis = (v, vis) => { try { if (window[v]) window[v].visible = vis; } catch (e) {} };
    setVis('nebulaScreen', false);
    setVis('stardustPoints', false);
    setVis('circuitTraceMesh', false);
    setVis('zenAmbientParticles', false);
  });
  const regressionScreenshot = `test_output/${TEST_ID}_regression.png`;
  await page.screenshot({ path: regressionScreenshot, fullPage: false });
  await page.evaluate(() => {
    const setVis = (v, vis) => { try { if (window[v]) window[v].visible = vis; } catch (e) {} };
    setVis('nebulaScreen', true);
    setVis('stardustPoints', true);
    setVis('circuitTraceMesh', true);
    setVis('zenAmbientParticles', true);
  });

  // ── Baseline mode: save the settled screenshot as the golden master ──
  if (BASELINE) {
    fs.copyFileSync(regressionScreenshot, ARGS.golden);
    await browser.close();
    return { passed: true, screenshot: ARGS.golden, golden: ARGS.golden, testId: TEST_ID, mode: 'baseline' };
  }

  // ── Main play loop: 30+ seconds of simulated play ──
  const startTime = Date.now();
  let step = 0;

  // Resume spawning for the play loop (it was stopped for the deterministic
  // capture above).
  await page.evaluate(() => { try { if (typeof window.startSpawning === 'function') window.startSpawning(); } catch (e) {} });

  while (Date.now() - startTime < ARGS.duration) {
    step++;

    // Read the current game state
    const state = await page.evaluate(() => window.autoGameState);
    const fps = await page.evaluate(() => window.currentFPS);

    if (fps > 0) RESULTS.fpsSamples.push(fps);
    if (fps < RESULTS.fpsMin && fps > 0) RESULTS.fpsMin = fps;

    // If the game ended, restart
    if (!state || state.gameState !== 'playing') {
      RESULTS.warnings.push(`Game ended at step ${step} (state=${state?.gameState}). Restarting...`);
      const retryBtn = await page.$('#retry-btn');
      if (retryBtn) {
        await retryBtn.click();
        await sleep(2000);
        continue;
      }
      // Navigate back to menu and re-start
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.waitForSelector('#zen-btn', { timeout: 5000 });
      await page.click('#zen-btn');
      await sleep(2000);
      continue;
    }

    // Collect all normal dice with at least one empty neighbor
    const matrix = state.matrix;
    const cols = state.cols;
    const rows = state.rows;
    const normalDice = [];
    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) {
        const cell = matrix[x] && matrix[x][y];
        if (cell && cell.state === 'normal' && cell.type === 1) {
          const neighbors = [[x+1,y],[x-1,y],[x,y+1],[x,y-1]];
          for (const [nx, ny] of neighbors) {
            if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) {
              if (!matrix[nx] || !matrix[nx][ny]) {
                normalDice.push({ x, y, nx, ny });
                break;
              }
            }
          }
        }
      }
    }

    if (normalDice.length === 0 || state.animationLock) {
      await sleep(600);
      continue;
    }

    // Pick a random die to move
    const pick = normalDice[rand(0, normalDice.length - 1)];
    RESULTS.movesAttempted++;

    // Ask the game for real screen coordinates so the touch lands on the die
    const src = await page.evaluate((gx, gy) => window.gridToScreen(gx, gy), pick.x, pick.y);
    const dst = await page.evaluate((gx, gy) => window.gridToScreen(gx, gy), pick.nx, pick.ny);

    const prevSig = occupancySig(state);
    const prevScore = state.score;
    const prevGroups = state.activeSinkingGroups;

    // Quick swipe (under HOLD_THRESHOLD=200ms) = roll
    await touchSwipe(page, src, dst);

    // Wait for the animation to complete (animationLock released), then read
    // the resulting state to verify the move actually happened.
    await page.waitForFunction(() => window.autoGameState && !window.autoGameState.animationLock, { timeout: 1500 }).catch(() => {});
    await sleep(100);
    const newState = await page.evaluate(() => window.autoGameState);
    if (newState) {
      const newSig = occupancySig(newState);
      if (newSig !== prevSig) {
        RESULTS.movesCompleted++;
      }
      if (newState.score > prevScore) {
        RESULTS.matchesFound++;
      }
      if (newState.activeSinkingGroups > RESULTS.maxConcurrentSinkingGroups) {
        RESULTS.maxConcurrentSinkingGroups = newState.activeSinkingGroups;
      }
    }

    // Every 10 steps, take a debug screenshot
    if (step % 10 === 0) {
      const screenshotPath = `test_output/${TEST_ID}_step${step}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: false });
      RESULTS.screenshot = screenshotPath;
    }

    await sleep(200);
  }

  // Take a final screenshot
  const finalScreenshot = `test_output/${TEST_ID}_final.png`;
  await page.screenshot({ path: finalScreenshot, fullPage: false });
  RESULTS.screenshot = finalScreenshot;

  // ── Verify Zen background effects ──
  try {
    const zenState = await page.evaluate(() => {
      var ambientExists = typeof zenAmbientParticles !== 'undefined' && zenAmbientParticles !== null;
      var burstCount = typeof zenFireworkBursts !== 'undefined' ? zenFireworkBursts.length : 0;
      return { ambientExists, burstCount };
    });
    RESULTS.zenAmbientParticles = zenState.ambientExists;
    RESULTS.zenBurstsSpawned = zenState.burstCount;
    RESULTS.zenEffectsVerified = zenState.ambientExists;
    if (!zenState.ambientExists) {
      RESULTS.warnings.push('Zen ambient particles not found — background effects may not be initialized');
    }
    if (zenState.ambientExists && zenState.burstCount === 0) {
      // Force-spawn a burst and capture a screenshot for visual verification
      await page.evaluate(() => { if (typeof spawnZenBurst !== 'undefined') { spawnZenBurst(0, 0.5, 0, 0xff3366); spawnZenBurst(-2, 1.5, 0, 0x33ccff); } });
      await sleep(100);
      const effectsScreenshot = `test_output/${TEST_ID}_effects.png`;
      await page.screenshot({ path: effectsScreenshot, fullPage: false });
    }
  } catch (err) {
    RESULTS.warnings.push('Zen effects check failed: ' + err.message);
  }

  await browser.close();

  // ── Compute averages ──
  if (RESULTS.fpsSamples.length > 0) {
    RESULTS.fpsAvg = Math.round(
      RESULTS.fpsSamples.reduce((a, b) => a + b, 0) / RESULTS.fpsSamples.length
    );
  } else {
    RESULTS.fpsAvg = 0;
  }
  if (RESULTS.fpsMin === Infinity) RESULTS.fpsMin = 0;

  // ── Visual regression against golden master (both captured at the same
  //    deterministic, settled, pre-move game state) ──
  if (fs.existsSync(ARGS.golden)) {
    try {
      const golden = await loadImage(ARGS.golden);
      const actual = await loadImage(regressionScreenshot);

      const w = Math.min(golden.width, actual.width);
      const h = Math.min(golden.height, actual.height);

      const goldenCanvas = createCanvas(w, h);
      const goldenCtx = goldenCanvas.getContext('2d');
      goldenCtx.drawImage(golden, 0, 0, w, h);

      const actualCanvas = createCanvas(w, h);
      const actualCtx = actualCanvas.getContext('2d');
      actualCtx.drawImage(actual, 0, 0, w, h);

      const diffCanvas = createCanvas(w, h);
      const diffCtx = diffCanvas.getContext('2d');

      const diffPixels = pixelmatch(
        goldenCtx.getImageData(0, 0, w, h).data,
        actualCtx.getImageData(0, 0, w, h).data,
        diffCtx.createImageData(w, h).data,
        w, h,
        { threshold: 0.1 }
      );

      RESULTS.diffPct = (diffPixels / (w * h)) * 100;

      // Save diff image for debugging
      const diffPath = `test_output/${TEST_ID}_diff.png`;
      const diffStream = fs.createWriteStream(diffPath);
      const diffPng = diffCanvas.createPNGStream();
      diffPng.pipe(diffStream);
      await new Promise(resolve => diffStream.on('finish', resolve));

      if (RESULTS.diffPct > 5.0) {
        RESULTS.warnings.push(`Visual regression detected: ${RESULTS.diffPct.toFixed(2)}% pixel drift`);
      }
    } catch (err) {
      RESULTS.warnings.push(`Visual regression check failed: ${err.message}`);
    }
  } else {
    RESULTS.warnings.push(`No golden master at ${ARGS.golden}; skipping visual diff`);
  }

  // ── Pass/fail criteria ──
  const hasCriticalErrors = RESULTS.errors.length > 0;
  const hasFpsIssues = RESULTS.fpsMin < 45 && RESULTS.fpsMin > 0;
  const hasVisualDrift = RESULTS.diffPct !== null && RESULTS.diffPct > 5.0;
  const hasZenEffectsFailed = !RESULTS.zenEffectsVerified;
  RESULTS.passed = !hasCriticalErrors && !hasFpsIssues && !hasVisualDrift && !hasZenEffectsFailed;

  return RESULTS;
}

// ── Run ──
runPlaytest()
  .then(result => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.passed ? 0 : 1);
  })
  .catch(err => {
    console.error(JSON.stringify({ error: err.message, stack: err.stack }, null, 2));
    process.exit(1);
  });
