---
title: "Make audio unlock bulletproof across browsers (Chrome silent while Firefox works)"
priority: 1
---

User report: audio plays fine on Firefox mobile, but Chrome is silent (cache cleared + private tab tested — so NOT the service worker). Diagnosis: Chrome's stricter autoplay policy + a resume/play race — Chrome resolves `HTMLMediaElement.play()` even while the AudioContext is still `suspended` (element plays silently through the suspended graph), and the current unlock calls `play()` immediately after `audioCtx.resume()` (async), so the track can end up in a silent "playing" state. Firefox is more lenient, hence the difference.

## The fix (exact — apply to game.js)

1. **`ensureMusicElement` (~line 255): append the element to the DOM.** After creating the `<audio>` element (before/after `createMediaElementSource`), add `document.body.appendChild(el);`. This eliminates Chrome's detached-element audio quirks. Keep everything else the same (still cached in `musicElements`).

2. **`unlockAudio` in `setupControlListeners` (~line 1788): resume-then-play ordering + retry.** Restructure so the music starts ONLY after `resume()` resolves, with a fallback retry if resume rejects:

```js
function unlockAudio() {
    if (audioUnlockDone) return;
    audioUnlockDone = true;
    function startMusic() {
        if (!musicEnabled) return;
        if (gameState === 'menu') AudioEngine.startMenuMusic();
        else if (gameState === 'playing') AudioEngine.startBGM(gameMode);
    }
    try {
        if (audioCtx && audioCtx.state === 'suspended') {
            var p = audioCtx.resume();
            if (p && p.then) { p.then(startMusic).catch(function() { setTimeout(startMusic, 250); }); }
            else startMusic();
        } else {
            startMusic();
        }
    } catch (e) { try { startMusic(); } catch (e2) { /* silent */ } }
}
```

3. **Register the unlock on MORE gesture types** (Chrome can consume transient activation on `pointerdown`): in addition to `pointerdown`, `keydown`, `touchstart`, also add `pointerup`, `click`, `mousedown`. Same listener, all guarded by `audioUnlockDone`.

4. **Retry `play()` once on rejection in `setMusic`** (both the same-mode branch and the new-track branch): if the play promise rejects, schedule ONE retry after 300ms:

```js
if (playResult && playResult.catch) {
    playResult.catch(function() {
        setTimeout(function() { try { el.play().catch(function() {}); } catch (e) { /* silent */ } }, 300);
    });
}
```

(Keep the existing silent-catch style. No console.error anywhere in audio code.)

## Constraints

- `"use strict";`, `var` not let/const, Three.js r128. Silent try/catch everywhere — no console.error.
- Change ONLY the audio unlock/play paths above. Do NOT touch the mixing graph, SFX recipes, call sites, toggles, or non-audio code. Do NOT touch sw.js (already fixed separately).
- No git commit. Do NOT run orchestrator.py or the playtester. Syntax-check only: `node -e "new Function(require('fs').readFileSync('game.js','utf8'))"`.
- Do NOT web-search, do NOT print large file chunks. Implement immediately.

## Report

1. Exact diff
2. Confirm the resume-then-play ordering and retry behavior
