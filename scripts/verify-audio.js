#!/usr/bin/env node
// Audio overhaul probe (req 09 + 10). Verifies headless:
//   1. No console errors from audio code (silent try/catch)
//   2. Audio files fetchable
//   3. Mode switching swaps tracks (menu -> zen -> menu -> battle) and the OLD
//      track actually PAUSES (req 10 crossfade fix) — no mixed tracks
//   4. Music toggle off pauses / on resumes; sound toggle wires soundEnabled
// Uses window.musicElements / window.activeMusicMode (elements are detached
// from the DOM, so querySelectorAll('audio') finds nothing).
const puppeteer = require('/home/kolslorr/workspace/devil-dice/node_modules/puppeteer');

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox','--disable-gpu','--use-gl=angle','--use-angle=swiftshader'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 450, height: 850 });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0,150)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0,150)); });

  await page.goto('http://localhost:8000/?seed=20260802', { waitUntil: 'load', timeout: 20000 });
  await new Promise(r => setTimeout(r, 1200));

  const audioState = () => page.evaluate(() => {
    const out = { active: window.activeMusicMode || null, ctx: window.audioCtx ? window.audioCtx.state : 'none' };
    out.els = {};
    for (const k in window.musicElements || {}) {
      const el = window.musicElements[k];
      out.els[k] = { paused: el.paused, t: +el.currentTime.toFixed(1) };
    }
    return out;
  });

  let pass = 0, fail = 0;
  const check = (ok, label) => { if (ok) pass++; else fail++; console.log(`[${ok?'PASS':'FAIL'}] ${label}`); };

  for (const f of ['audio/menu.mp3','audio/zen.mp3','audio/battle.mp3','audio/puzzle.mp3']) {
    const s = await page.evaluate(async (f) => { try { return (await fetch(f)).status; } catch (e) { return 'ERR'; } }, f);
    check(s === 200, `fetch ${f} -> ${s}`);
  }

  // Menu: element created, mode=menu (may be paused by autoplay policy pre-gesture)
  const menu0 = await audioState();
  check(menu0.active === 'menu' && !!menu0.els.menu, `menu state: active=${menu0.active} hasMenuEl=${!!menu0.els.menu}`);

  // Zen (gesture unlocks audio)
  await page.waitForSelector('#zen-btn', { timeout: 8000 }).catch(()=>{});
  await page.click('#zen-btn');
  await new Promise(r => setTimeout(r, 3000)); // > 550ms crossfade
  const zen = await audioState();
  console.log('[info] zen:', JSON.stringify(zen));
  check(zen.active === 'zen', 'zen mode: active track = zen');
  check(zen.els.zen && !zen.els.zen.paused && zen.els.zen.t > 0.5, 'zen track playing (t advancing)');
  check(zen.els.menu && zen.els.menu.paused, 'zen mode: menu track PAUSED (req 10 — no mixed tracks)');

  // Back to menu
  await page.evaluate(() => { try { quitToMenu(); } catch(e){} });
  await new Promise(r => setTimeout(r, 1500));
  const menu1 = await audioState();
  console.log('[info] menu:', JSON.stringify(menu1));
  check(menu1.active === 'menu' && menu1.els.menu && !menu1.els.menu.paused, 'menu track playing after quitToMenu');
  check(menu1.els.zen && menu1.els.zen.paused, 'zen track paused in menu');

  // Battle
  await page.waitForSelector('#battle-btn', { timeout: 5000 }).catch(()=>{});
  await page.click('#battle-btn').catch(()=>{});
  await new Promise(r => setTimeout(r, 3000));
  const battle = await audioState();
  console.log('[info] battle:', JSON.stringify(battle));
  check(battle.active === 'battle' && battle.els.battle && !battle.els.battle.paused, 'battle track playing');
  check(battle.els.menu && battle.els.menu.paused, 'battle mode: menu paused');

  // Music toggle off / on
  await page.evaluate(() => { const t = document.getElementById('music-toggle'); t.checked = false; t.dispatchEvent(new Event('change')); });
  await new Promise(r => setTimeout(r, 1000));
  const off = await audioState();
  const anyPlaying = Object.values(off.els).some(e => !e.paused);
  check(!anyPlaying, 'music toggle OFF: nothing playing');

  await page.evaluate(() => { const t = document.getElementById('music-toggle'); t.checked = true; t.dispatchEvent(new Event('change')); });
  await new Promise(r => setTimeout(r, 1200));
  const on = await audioState();
  check(on.active === 'battle' && on.els.battle && !on.els.battle.paused, 'music toggle ON: battle resumes');

  const st = await page.evaluate(() => {
    const s = document.getElementById('sound-toggle');
    const before = window.soundEnabled;
    s.checked = false; s.dispatchEvent(new Event('change'));
    const after = window.soundEnabled;
    s.checked = true; s.dispatchEvent(new Event('change'));
    return { before, after };
  });
  check(st.before === true && st.after === false, 'sound toggle wires soundEnabled');

  console.log('[result] PASS:', pass, 'FAIL:', fail);
  console.log('[errors]', errors.length ? errors.slice(0,8) : 'none');
  await browser.close();
})().catch(e => { console.log('[fatal]', e.message.slice(0,300)); process.exit(1); });
