---
title: "Fix BGM crossfade: old track never pauses when switching modes (mixed tracks)"
priority: 1
---

Bug (verified headless): switching from menu to zen starts zen.mp3 BUT menu.mp3 keeps playing — both tracks audible simultaneously. The 550ms fade-out pause timer never fires.

## Root cause (diagnosed — do not re-investigate)

In `AudioEngine.setMusic` (game.js ~line 271):

1. `startGame` calls `AudioEngine.stopMenuMusic()` → `stopBGM()`, which sets `activeMusicMode = null` AND schedules a 550ms timer that pauses all music elements.
2. Immediately after, `startBGM(mode)` → `setMusic(mode)` — at its top it runs `if (musicTimerId) { clearTimeout(musicTimerId); musicTimerId = null; }` which **clears stopBGM's pause timer**.
3. `setMusic` then looks up the old track via `var current = activeMusicMode ? musicElements[activeMusicMode] : null;` — but `activeMusicMode` is now `null` (stopBGM nulled it), so `current` is null and the "fade out + pause old element" branch is skipped entirely.
4. Result: the menu element is never paused; the shared `musicGain` ramps back to 0.55 for the new track → both tracks audible.

## The fix (exact — apply to `setMusic`)

1. Replace the `var current = activeMusicMode ? musicElements[activeMusicMode] : null;` lookup with a **scan for any currently-playing element**, independent of `activeMusicMode`:

```js
var current = null;
for (var m in musicElements) {
    if (musicElements[m] && !musicElements[m].paused) { current = musicElements[m]; break; }
}
```

2. Only fade out + schedule the pause timer when `current` exists AND `current !== musicElements[mode]` (i.e., we're actually switching away from a playing track). The timer should pause `current` (the captured element) after the ~550ms fade, exactly as the current branch already does.
3. Keep the `clearTimeout(musicTimerId)` at the top — the new deterministic timer replaces any stale one. Keep `activeMusicMode = mode` assignment at the end.
4. Do NOT change anything else in the AudioEngine, and do NOT touch `stopBGM`/`startMenuMusic`/`startBGM` call sites or the toggle wiring.

Sanity-check with the browser console: after `quitToMenu` + `startGame('zen')`, only ONE audio element should be unpaused at any time once the crossfade completes.

## Constraints

- `"use strict";`, `var` not let/const, Three.js r128. Silent try/catch — no console.error anywhere in audio code.
- No other files. No git commit. Do NOT run orchestrator.py or the playtester. Syntax-check only: `node -e "new Function(require('fs').readFileSync('game.js','utf8'))"`.
- Do NOT web-search, do NOT print large file chunks. Implement immediately.

## Report

1. The exact diff inside `setMusic`
2. Confirm the scan + pause behavior
