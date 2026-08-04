---
title: "Win/lose music: congratulatory victory track and damning defeat track"
priority: 1
---

# Victory / Defeat Music

## Goal (user's words)

"When I win any stage, or if I beat the AI opponent, the music should transit
to a congratulatory note, and if I lost then choose some damning score. Be
creative!"

The BGM must TRANSITION (crossfade) to a victory piece on win and to an ominous
defeat piece on loss — not just the current short synth jingles.

## Assets (already prepared by the requester — do NOT re-encode)

- `audio/win.mp3` — "Voxel Revolution" (Kevin MacLeod, CC-BY), 32s, mono,
  loudnorm −14 LUFS. Congratulatory/epic.
- `audio/lose.mp3` — "Despair and Triumph" (Kevin MacLeod, CC-BY), 32s, mono,
  loudnorm −16 LUFS. Dark/damning.
- Credits already added to `audio/CREDITS.md`.

## Implementation (decisions pre-made)

### 1. TRACKS + elements

- `TRACKS` (game.js line 72) gains: `win: 'audio/win.mp3', lose: 'audio/lose.mp3'`.
- `ensureMusicElement('win'/'lose')` already lazily creates the elements via
  the TRACKS lookup — no changes needed there.

### 2. New AudioEngine methods

```js
playVictory: function() { this.setMusic('win'); },   // crossfade BGM -> win track
playDefeat:  function() { this.setMusic('lose'); },  // crossfade BGM -> lose track
```

`setMusic` already crossfades from whatever is playing (it scans
`musicElements` for the playing element, ramps it out, pauses it after 550ms,
and fades the new track in) — so playVictory/playDefeat ARE the transition.
No new crossfade code needed. Respect the music toggle (setMusic already
early-returns when `!musicEnabled`).

### 3. Trigger points

- **Puzzle stage clear** (`decrementPuzzleMove` win branch, non-final stage,
  game.js ~line 1691): call `AudioEngine.playVictory()` at the clear moment
  (music transits to the victory note during the banner). Change the
  auto-advance delay 1800ms → 2200ms so the note lands. In the auto-advance
  callback (after `setupPuzzleStage()`), call
  `AudioEngine.startBGM('puzzle')` so the next stage's puzzle track resumes.
- **Puzzle ALL CLEARED** (final stage → `triggerGameOver`): victory sustained.
- **Battle win** (`triggerGameOver`, `playerWon`): victory sustained.
- **Battle lose**: defeat sustained.
- **Puzzle OUT OF MOVES**: defeat sustained.
- **Zen board-filled** (`triggerGameOver`, non-battle): defeat sustained
  (the board filling is a loss).

Replace the block in `triggerGameOver` (game.js ~line 1616):
```js
if (isBattle && playerWon) AudioEngine.playWin(); else AudioEngine.playGameOver();
```
with:
```js
var won = (isBattle && playerWon) || (gameMode === 'puzzle' && puzzleCleared);
if (won) AudioEngine.playVictory(); else AudioEngine.playDefeat();
```
(zen + puzzle-out-of-moves + battle-lose all hit playDefeat). `triggerGameOver`
already calls `AudioEngine.stopBGM()` before this — setMusic handles the
already-fading state fine.

Keep the existing `playWin()` / `playGameOver()` methods in the engine (other
callers/tests may use them) — they are just no longer the game-over path.

### 4. sw.js (offline precache)

- Add `'audio/win.mp3'` and `'audio/lose.mp3'` to the `ASSETS` array.
- Bump `CACHE_NAME` from `'devildice-v3'` to `'devildice-v4'` (forces the new
  precache to install; old caches are purged on activate).

### 5. Edge cases

- Returning to menu after game over already calls `startMenuMusic()` in
  `quitToMenu` — setMusic crossfades win/lose → menu. No extra work.
- `pauseGame` → `stopBGM` pauses the win/lose element too (it scans all
  musicElements). Fine.
- Music toggle OFF on the game-over screen: setMusic early-returns, nothing
  plays — correct. Toggle ON: current handler only restarts for
  gameState menu/playing; leave as-is (game-over music staying off after an
  explicit toggle-off is acceptable).
- Do NOT play win/lose at stage clear when the player just re-entered a stage
  via retry — the win branch only fires on an actual clear. No change needed.

## Acceptance (requester will verify)

1. Puzzle stage clear → music transits to win track, then puzzle track resumes
   for the next stage (probe: play stage 1 solution, assert activeMusicMode
   becomes 'win', then 'puzzle' after auto-advance).
2. Battle win → activeMusicMode 'win'; battle lose / zen fill / puzzle
   out-of-moves → activeMusicMode 'lose'.
3. win.mp3/lose.mp3 fetch 200; sw.js v4 precaches them; no console errors.
4. Orchestrator playtest stays PASSED (drift + zen) — audio changes must not
   break the playtester's capture (music bus only; no renderer impact).

## Files

- `game.js`, `sw.js` ONLY. No commits. No orchestrator/browser runs (the
  requester verifies).
