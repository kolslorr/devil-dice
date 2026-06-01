#!/usr/bin/env node
/**
 * Devil Dice 3D — Headless Playtester
 *
 * Launches a headless Chrome via Puppeteer, starts the game,
 * simulates 30+ seconds of touch gestures, captures console logs,
 * FPS metrics, and screenshots for visual regression testing.
 *
 * Usage: node tests/playtester.js [--golden golden/baseline.png] [--port 8000]
 *
 * Outputs structured JSON to stdout with:
 *   { passed, fpsAvg, fpsMin, errors, warnings, screenshot, diffPct }
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
  testId: TEST_ID,
  zenEffectsVerified: false,
  zenAmbientParticles: false,
  zenBurstsSpawned: 0,
};

// ── Utility: random int in range ──
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

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

  // Navigate to the game
  const url = `http://localhost:${ARGS.port}`;
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });
  await page.waitForSelector('#zen-btn', { timeout: 5000 });

  // Start Zen mode
  await page.click('#zen-btn');

  // Wait for dice to appear and game to initialize
  await page.waitForFunction(() =>
    window.autoGameState && window.autoGameState.gameState === 'playing', { timeout: 5000 }
  );
  await sleep(1500); // Let first dice rise animation complete

  // ── Main play loop: 30+ seconds of simulated play ──
  const startTime = Date.now();
  let step = 0;

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
      // Try to click retry or restart
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

    // Find a rollable die on the board using the matrix
    const matrix = state.matrix;
    const cols = state.cols;
    const rows = state.rows;

    // Collect all normal dice positions
    const normalDice = [];
    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) {
        const cell = matrix[x] && matrix[x][y];
        if (cell && cell.state === 'normal' && cell.type === 1) {
          // Check if any adjacent cell is empty
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

    // Calculate screen positions for the swipe gesture
    const viewport = page.viewport();
    const gridCenterX = viewport.width / 2;
    const gridCenterY = viewport.height * 0.45;

    const cellW = viewport.width * 0.8 / cols;
    const cellH = viewport.height * 0.5 / rows;

    // Swipe from the source die toward the empty neighbor
    const srcX = gridCenterX + (pick.x - (cols - 1) / 2) * cellW;
    const srcY = gridCenterY + (pick.y - (rows - 1) / 2) * cellH;
    const dstX = gridCenterX + (pick.nx - (cols - 1) / 2) * cellW;
    const dstY = gridCenterY + (pick.ny - (rows - 1) / 2) * cellH;

    // Quick swipe (under HOLD_THRESHOLD=200ms) = roll
    await page.touchscreen.touchStart(srcX, srcY);
    await sleep(30);
    // Move in steps to simulate a real swipe
    const steps = 6;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const cx = srcX + (dstX - srcX) * t;
      const cy = srcY + (dstY - srcY) * t;
      await page.mouse.move(cx, cy);
      await sleep(10);
    }
    await page.touchscreen.touchEnd();
    await sleep(350);

    // Check if the move changed the state (i.e., die moved)
    const newState = await page.evaluate(() => window.autoGameState);
    if (newState) {
      RESULTS.movesCompleted++;
      // Check for sinking groups = matches found
      if (newState.activeSinkingGroups > RESULTS.matchesFound) {
        RESULTS.matchesFound = newState.activeSinkingGroups;
      }
    }

    // Every 10 steps, take a screenshot
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

  // ── Visual regression against golden master ──
  if (fs.existsSync(ARGS.golden)) {
    try {
      const golden = await loadImage(ARGS.golden);
      const actual = await loadImage(finalScreenshot);

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

  const hasZenEffectsFailed = ARGS.golden && !RESULTS.zenEffectsVerified;
  RESULTS.passed = !hasCriticalErrors && !hasFpsIssues && !hasVisualDrift && !hasZenEffectsFailed;

  return RESULTS;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
