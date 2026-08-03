#!/usr/bin/env node
// Real-Chrome autoplay policy probe: launches WITHOUT puppeteer's
// --autoplay-policy=no-user-gesture-required exemption, so the audio engine
// must unlock via genuine trusted user gestures — mirroring the user's Chrome.
// Instruments HTMLMediaElement.prototype.play() and AudioContext.resume() to
// capture exactly when/why play() gets rejected or silently resolves.
const puppeteer = require('/home/kolslorr/workspace/devil-dice/node_modules/puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=user-gesture-required'],
  });
  const spawnArgs = browser.process().spawnargs;
  console.log('[info] autoplay-related launch args:', spawnArgs.filter(a => a.includes('autoplay') || a.includes('mute')));

  const page = await browser.newPage();
  await page.setViewport({ width: 450, height: 850 });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });

  await page.evaluateOnNewDocument(() => {
    window.__playLog = [];
    const origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      const ctx = window.audioCtx;
      const tag = (this.src || '?').split('/').pop();
      const entry = { at: Date.now(), el: tag, ctxState: ctx ? ctx.state : 'no-ctx' };
      try {
        const p = origPlay.apply(this, arguments);
        if (p && p.then) {
          p.then(() => { entry.result = 'RESOLVED'; window.__playLog.push(entry); })
           .catch(e => { entry.result = 'REJECTED:' + e.name + ':' + (e.message || '').slice(0, 60); window.__playLog.push(entry); });
        } else { entry.result = 'SYNC'; window.__playLog.push(entry); }
        return p;
      } catch (e) {
        entry.result = 'THREW:' + e.name; window.__playLog.push(entry); throw e;
      }
    };
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC && AC.prototype.resume) {
      const origResume = AC.prototype.resume;
      AC.prototype.resume = function () {
        const entry = { at: Date.now(), kind: 'resume', ctxState: this.state };
        const p = origResume.apply(this, arguments);
        p.then(() => { entry.result = 'RESOLVED'; window.__playLog.push(entry); })
         .catch(e => { entry.result = 'REJECTED:' + e.name; window.__playLog.push(entry); });
        return p;
      };
    }
  });

  await page.goto('http://localhost:8000/?seed=20260802', { waitUntil: 'load', timeout: 20000 });
  await new Promise(r => setTimeout(r, 1200));

  const dump = () => page.evaluate(() => {
    const out = {
      ctx: window.audioCtx ? window.audioCtx.state : 'none',
      active: window.activeMusicMode || null,
      musicGain: window.musicGain ? +window.musicGain.gain.value.toFixed(3) : null,
      soundEnabled: window.soundEnabled,
      musicEnabled: window.musicEnabled,
    };
    try { out.gameState = window.autoGameState.gameState; } catch (e) { out.gameState = 'getter-throw'; }
    out.els = {};
    for (const k in window.musicElements || {}) {
      const el = window.musicElements[k];
      out.els[k] = { paused: el.paused, t: +el.currentTime.toFixed(2), ready: el.readyState };
    }
    return out;
  });

  let pass = 0, fail = 0;
  const check = (ok, label) => { if (ok) pass++; else fail++; console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}`); };

  console.log('[state] initial:', JSON.stringify(await dump()));
  console.log('[playLog] initial:', JSON.stringify(await page.evaluate(() => window.__playLog)));

  // Trusted click on Zen button (first user gesture)
  const bb = await (await page.$('#zen-btn')).boundingBox();
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await new Promise(r => setTimeout(r, 2500));

  console.log('[state] after zen click:', JSON.stringify(await dump()));
  console.log('[playLog] after zen click:', JSON.stringify(await page.evaluate(() => window.__playLog)));

  const s1 = await dump();
  check(s1.ctx === 'running', 'AudioContext resumed -> running after trusted click');
  check(s1.active === 'zen', 'active track = zen after startGame');
  check(s1.els.zen && !s1.els.zen.paused && s1.els.zen.t > 0.5, 'zen track playing (t advancing)');

  // SFX path must be live now (ctx running)
  await page.evaluate(() => { try { AudioEngine.playSlide(); } catch (e) {} });
  await new Promise(r => setTimeout(r, 300));

  // Back to menu -> menu music (unlock already done)
  await page.evaluate(() => { try { quitToMenu(); } catch (e) {} });
  await new Promise(r => setTimeout(r, 1500));
  console.log('[state] after quitToMenu:', JSON.stringify(await dump()));
  const s2 = await dump();
  check(s2.active === 'menu' && s2.els.menu && !s2.els.menu.paused && s2.els.menu.t > 0, 'menu track playing after quitToMenu');

  console.log('[result] PASS:', pass, 'FAIL:', fail);
  console.log('[errors]', errors.length ? errors.slice(0, 8) : 'none');
  await browser.close();
})().catch(e => { console.log('[fatal]', e.message.slice(0, 300)); process.exit(1); });
