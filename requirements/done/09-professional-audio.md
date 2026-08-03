---
title: "Professional audio overhaul: per-mode background music (real tracks) + polished Web Audio SFX"
priority: 1
---

The current audio is "simple and amateurish": one shared triangle-melody BGM for every mode (same loop for menu/zen/battle/puzzle), basic oscillator blips for every SFX, and the music toggle UI is dead (unwired). Make it sound like a modern popular mobile game: real per-mode background music, polished SFX with reverb/compression, proper mixing, and working toggles.

## Assets already prepared (do NOT download, do NOT modify)

`audio/menu.mp3` (~100s), `audio/zen.mp3` (~120s), `audio/battle.mp3` (~90s), `audio/puzzle.mp3` (~90s) — mono, loudness-normalized, served same-origin from the repo root. `audio/CREDITS.md` has attribution. These files are done — leave them alone.

## AudioEngine redesign (game.js, the whole `AudioEngine` object ~lines 93-174)

Preserve the EXACT public API so existing call sites keep working:
`init`, `playMove`, `playRoll`, `playSlide`, `playHaptic`, `playMatch`, `playCombo(c)`, `playGameOver`, `playWin`, `playLockBlock`, `playNoise`, `startBGM(mode)`, `stopBGM`, `startMenuMusic`, `stopMenuMusic`. (The only signature change: `startBGM` now takes a mode arg.)

### Mixing graph (professional baseline)
- `audioCtx` (lazily created in `init`, try/catch) → `masterGain` (0.8) → `DynamicsCompressorNode` (threshold −12dB, knee 20, ratio 4, attack 0.003, release 0.25) → destination.
- `sfxGain` → compressor; `musicGain` → compressor.
- **Reverb bus**: `ConvolverNode` with a generated stereo impulse (2s noise with exponential decay), `reverbGain` ~0.3 → compressor. SFX that need space (match/combo/win/gameover) send into it via per-sound send gains.
- All audio graph code wrapped in try/catch. **NEVER call console.error from audio code** — a failure must be silent (the headless playtester fails on console errors, and audio must never break the game).

### SFX recipes (exact — make them sound GOOD, not like blips)
Internal helpers: `tone({freq, type, dur, gain, attack, release, slideTo, detune, pan, reverbSend})` with proper gain envelopes (attack ramp up, exponential release to 0.001) and optional StereoPannerNode; `noiseBurst({dur, gain, filterType, freqFrom, freqTo, Q})` with a white-noise buffer + BiquadFilter sweep.

- `playMove` (blocked): soft thud — tone sine 130→70Hz, 0.12s, gain 0.5.
- `playRoll`: dice tumble — noiseBurst bandpass 1200→500Hz, 0.05s, gain 0.25 + tone triangle 170→80Hz, 0.15s, gain 0.35. Add ±5% random pitch jitter for variety.
- `playSlide`: swoosh — noiseBurst bandpass 500→1800Hz, 0.18s, gain 0.2, Q 0.8.
- `playMatch`: satisfying pop — two detuned sines a fifth apart (660 & 990Hz), 0.35s, attack 0.002, reverbSend 0.5, + a highpass-noise sparkle (highpass 4000, 0.08s).
- `playCombo(c)`: rising sparkle arpeggio — base notes [523.25, 659.25, 783.99, 1046.5], each shifted UP by `min(c,5)*2` semitones (×2^(n/12)), 3 quick notes 60ms apart, reverbSend, plus a shimmering sine an octave up at the end.
- `playGameOver`: descending minor phrase [392, 349.23, 311.13, 233.08] (G4 F4 Eb4 Bb3) triangle, 0.28s apart, with a low sine pad (98Hz, 1.2s) and reverb.
- `playWin`: triumphant fanfare [523.25, 659.25, 783.99, 1046.5, 1318.5] 90ms apart, sine+triangle, reverb.
- `playLockBlock`: heavy thud — square 75→45Hz, 0.22s, gain 0.3.
- `playHaptic`: `navigator.vibrate(15)` + subtle tick (sine 210Hz, 0.05s, gain 0.15).
- `playNoise(dur, gainVal)`: keep as a generic white-noise helper (used internally).

### Music system (real tracks, per-mode)
- `TRACKS = { menu: 'audio/menu.mp3', zen: 'audio/zen.mp3', battle: 'audio/battle.mp3', puzzle: 'audio/puzzle.mp3' }`.
- One `<audio>` element per mode, created lazily and CACHED (`preload='auto'`, `loop=true`, no crossorigin needed — same-origin). Route through `MediaElementAudioSourceNode` → `musicGain`.
- `setMusic(mode)`: if the requested mode is already the active one, no-op. Otherwise fade out the current track (musicGain linearRamp 0→0 over ~0.5s, then pause), switch to the new track's element (`currentTime` keep or 0), `play()` (catch promise rejection silently), fade in 0→0.55 over ~0.8s. Track the active mode in a module var.
- `startBGM(mode)` → `setMusic(mode)`; `stopBGM()` → fade out + pause all; `startMenuMusic()` → `setMusic('menu')`; `stopMenuMusic()` → `stopBGM()`.
- Keep `bgmIntervalId`/`menuMusicIntervalId` vars removed or unused — the interval-based synth melodies are GONE.

### Autoplay policy
- Chrome blocks audio before a user gesture. Add an unlock: on first `pointerdown`/`keydown`/`touchstart` (register once in `setupControlListeners`), call `audioCtx.resume()` and if music should be playing, start it. All `play()` calls must catch rejection silently.

### Mode wiring (update these call sites)
- `startGame(mode)` (line ~1086): currently ends with `if (musicEnabled) { AudioEngine.stopBGM(); AudioEngine.startBGM(); }` → replace with `AudioEngine.startBGM(mode)`.
- `resumeGame` (~line 1089): `if (musicEnabled) AudioEngine.startBGM();` → `AudioEngine.startBGM(gameMode)`.
- `pauseGame`: already calls `AudioEngine.stopBGM()` — keep (pausing music on pause is correct).
- `quitToMenu`: already calls `AudioEngine.startMenuMusic()` — keep.
- Game over path (`triggerGameOver` or equivalent): ensure it stops BGM and plays `AudioEngine.playGameOver()` once.
- `var soundEnabled = true, musicEnabled = false` (line 62): change default to `musicEnabled = true`.

### Toggle wiring (currently DEAD UI — wire it)
- `#sound-toggle` change → `soundEnabled = checkbox.checked`.
- `#music-toggle` change → `musicEnabled = checkbox.checked`; if turning ON: if `gameState === 'menu'` → `startMenuMusic()` else `startBGM(gameMode)`; if turning OFF → `stopBGM()`. Initialize both checkboxes to match the current vars on load.
- `index.html` line 97: change the label text `BGM (Synth):` → `Music:`.

## Constraints

- `"use strict";`, `var` not let/const, Three.js r128, no ES modules. Keep `window.autoGameState`/`currentFPS`/`gridToScreen` hooks untouched.
- Do NOT touch gameplay, input, rendering, or any non-audio code except the exact call sites listed above. Do NOT touch the mp3 files or CREDITS.md.
- **No console.error from audio code — silent try/catch everywhere.** Audio failure must never break the game or fail the playtester.
- No git commit. Do NOT run orchestrator.py or the playtester. Syntax-check only: `node -e "new Function(require('fs').readFileSync('game.js','utf8'))"`.
- Do NOT web-search, do NOT print large file chunks. Implement immediately.

## Report when done

1. AudioEngine structure summary (graph, helpers, SFX list)
2. Call-site changes made (startGame/resumeGame/game over)
3. Toggle wiring + HTML label change
4. Risk areas (autoplay, headless playback, anything that could console.error)
