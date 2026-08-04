---
title: "Puzzle mode revamp: 50 pre-crafted stages with saved progression"
priority: 1
---

# Puzzle Mode Revamp — 50 Pre-Crafted Stages + Saved Progression

## Goal (user's words)

Replace the random per-stage puzzle generation with 50 hand-crafted stages that
progress from easy to difficult. Easy stages start with fewer dice and generally
take 1–2 moves to solve; complexity increases as stages progress. Progression
must be stored/remembered (like the high score, i.e. localStorage), and the
player resumes from the last solved puzzle — like the original Devil Dice
puzzle mode.

## Current implementation (what to replace)

- `puzzleMaxStages = 10` (game.js line 64)
- `setupPuzzleMode()` resets `puzzleStage = 1` on every entry — no persistence,
  retry always returns to stage 1
- `generatePuzzleLayout(stage)` (game.js ~line 1637) randomly scatters clusters;
  `setupPuzzleStage()` (~line 1618) places them
- Moves = `5 + stage*3 + rand(0..3)`; EVERY roll/slide attempt consumes a move,
  even a BLOCKED one (triggerRoll/triggerSlide ~line 1252/1253 always call
  `decrementPuzzleMove()` in their onComplete)
- Win: `countPuzzleRemaining() === 0` (all non-sinking active dice gone);
  auto-advance after 1800ms banner; stage 10 → "ALL PUZZLES CLEARED!"
- Lose: `puzzleMovesRemaining <= 0` → `triggerGameOver()` "OUT OF MOVES!"
- Puzzle uses the user's board-size setting (default 7x7) — no per-stage boards
- Puzzles are generated, so stages have NO authored solutions and no difficulty
  curve

## New architecture (all decisions pre-made — implement exactly this)

### 1. New file `puzzle-stages.js` (repo root, next to game.js)

Loaded via a NEW `<script src="puzzle-stages.js"></script>` tag in index.html
**BEFORE** the game.js script tag. Defines exactly one global:

```js
var PUZZLE_STAGES = [ /* 50 entries, index 0 = stage 1 */ ];
```

Each entry:

```js
{
  board: { cols: 5, rows: 5 },          // per-stage board size
  moves: 2,                             // move budget for this stage
  walls: [{x:0,y:2},{x:4,y:2}],         // optional locked cells (walls); may be empty
  dice: [
    { x: 1, y: 1, v: 4, rot: 0 },       // v = top face, rot = Y-rotation 0..3 (side-face fix)
    { x: 2, y: 1, v: 4, rot: 0 }
  ],
  solution: [
    { x: 1, y: 1, dir: 'east' },        // move the die currently at (x,y) in dir
    ...
  ]
}
```

- `solution` is the authoritative solving sequence: for every step, the die
  currently at that (x,y) is rolled/slid one cell in `dir` (dir ∈
  east/west/south/north). Steps are executed in order; each step MUST be legal
  (die exists there, target cell inside board, target cell empty at that time,
  NOT occupied by a die or wall).
- The last step must leave zero active dice (all sunk), i.e. replaying
  `solution` clears the board.
- `solution.length` MUST be <= `moves` (the budget), leaving at least 1 spare
  move for all stages (budget = solution length + margin; margins grow with
  difficulty).
- NO comments or extra fields needed. Keep the file clean and data-only
  (`"use strict";` is NOT required in a data file, but the rest of the project
  conventions apply to code files).

### 2. Deterministic die orientation (CRITICAL — read this carefully)

`Die.prototype.forceTopValue()` (game.js ~line 546) applies a RANDOM Y-rotation
after setting the top face — this makes authored solutions impossible. Fix in
the `Die` constructor (game.js line 523):

- Add a 5th constructor arg `rotY` (default undefined).
- After `forceTopValue(topValue)` runs (the `else if` branch), if
  `typeof rotY === 'number'`, call `this._rotY()` exactly `rotY` times
  (0..3) **before** the materials are built (materials are created at line 535,
  after the face logic — keep that ordering).
- `rotY` must NOT affect the random branch (spawned zen/battle dice with no
  topValue stay fully random — do not touch that path).
- `setupPuzzleStage()` must create dice as `new Die(item.x, item.y, item.v,
  undefined, item.rot)` so every stage die has deterministic side faces.

Face truth table (game.js is the source of truth — read `STANDARD_ORIENTATIONS`
line 38 and `Die.prototype.roll` lines 582–585 and trace by hand when authoring
solutions; do NOT guess):

```
INITIAL_DIE_FACES = { top:1, bottom:6, front:2, back:5, left:4, right:3 }
STANDARD_ORIENTATIONS[1] = { top:1, bottom:6, front:2, back:5, left:4, right:3 }
STANDARD_ORIENTATIONS[2] = { top:2, bottom:5, front:6, back:1, left:4, right:3 }
[read entries 3..6 from game.js line 41+]

roll EAST  (dx+1): new top = old LEFT,   new right = old TOP,   new bottom = old RIGHT, new left = old BOTTOM
roll WEST  (dx-1): new top = old RIGHT,  new left = old TOP,    new bottom = old LEFT,  new right = old BOTTOM
roll SOUTH (dy+1): new top = old BACK,   new front = old TOP,   new bottom = old FRONT, new back = old BOTTOM
roll NORTH (dy-1): new top = old FRONT,  new back = old TOP,    new bottom = old BACK,  new front = old BOTTOM
_rotY(): front->right->back->left->front (rot applied to ALL faces of the die)
```

### 3. Blocked moves are FREE (change move counting)

A roll/slide attempt that does NOT move the die (target occupied by another die
or wall, or out of bounds) must NOT consume a move. Implementation:

- `Die.prototype.roll` (line 574) and `Die.prototype.slide` (line 603): the
  `onComplete` callback is called on both success and blocked paths. Make the
  callback receive a `moved` boolean: `onComplete(true)` on actual movement,
  `onComplete(false)` on every early-return blocked path (out of bounds,
  target occupied, locked cell). Existing callers ignore the arg
  (battle/zen `function() { ... }` callbacks keep working unchanged).
- `triggerRoll` / `triggerSlide` (lines 1252–1253): change the callback to
  `function(moved) { ... if (gameMode === 'puzzle') { if (moved) decrementPuzzleMove(); } }`.
  Blocked attempts play `AudioEngine.playMove()` as today but do not decrement.

### 4. Per-stage board size

- Add `setPuzzleBoard(cols, rows)` (new helper, similar to `setBoardSize` at
  line 1191): sets GRID_COLS/GRID_ROWS/totalCells, resets `grid`, calls
  `buildBoard()`, `setupOrthoCamera()`, `resizeNebula()`. Do NOT touch the
  `boardSize` preset key (that stays the user's preference).
- `setupPuzzleStage()` starts by reading the stage from `PUZZLE_STAGES`, calling
  `setPuzzleBoard(stage.board.cols, stage.board.rows)`, then placing `walls`
  (as `new Die(x, y, 0, CELL_TYPE.LOCKED)` — locked dice have faces all 0 and
  block movement) then `dice` (with rot, state 'normal', height 0, materials
  rebuilt via `getDiceMaterials(d.faces, 'normal')` and `updateMeshPosition()`
  — same placement pattern as today's setupPuzzleStage lines 1626–1634).
- Save the user's board preset key (the `boardSize` variable) when puzzle mode
  starts and restore it with `setBoardSize(savedKey)` when leaving puzzle mode
  (quitToMenu / game over).

### 5. Progression persistence

- localStorage key: `devildice_puzzle_progress` — integer, 0..50, 0 = nothing
  cleared. Loaded once near `highScore` (localStorage has `devildice_zen_hs`;
  follow that pattern).
- On stage clear (`decrementPuzzleMove` win branch, line 1687): set progress =
  max(progress, puzzleStage) and save.
- Resume stage = `min(progress + 1, 50)`.
- `setupPuzzleMode()` (line 1617) must NOT hard-reset to 1 anymore: it uses a
  chosen-stage override if one was set by the stage-select screen, else the
  resume stage.

### 6. Stage select screen (new UI)

- New overlay in index.html: `<div id="puzzle-select-screen" class="screen">`
  containing:
  - Title "PUZZLE MODE"
  - Progress line: e.g. `STAGE 5 CLEARED — RESUME AT STAGE 6` (or
    `NO STAGES CLEARED YET` when progress = 0, `ALL 50 STAGES CLEARED!` when 50)
  - Primary button `#puzzle-resume-btn` "RESUME STAGE N" (N = resume stage)
  - `#puzzle-stage-grid` — a flex-wrap grid of 50 tile buttons
    (`<button class="puzzle-tile">`), each showing its number; classes:
    `.solved` (stage <= progress, shows a ✓), `.current` (stage == resume
    stage, highlighted), `.locked` (stage > resume stage, dimmed,
    non-clickable)
  - Back button `#puzzle-select-close` "BACK" → returns to menu screen
- Styles in style.css (glassmorphism, consistent with existing modals).
- `#puzzle-btn` click handler changes: instead of `startGame('puzzle')` it
  shows the select screen and builds the tile grid (rebuild on every open so
  progress updates). Tiles ≤ resume stage and the RESUME button call
  `startGame('puzzle')` with a chosen-stage override
  (e.g. `window._puzzleChosenStage = n; startGame('puzzle');`).
- `puzzleMaxStages` → 50 (line 64). Update the `#puzzle-stage` HUD label
  default to `STAGE 1/50`.

### 7. Game-over / retry behavior

- `retry-btn` (PLAY AGAIN) handler (line ~1800): currently `startGame(gameMode)`.
  For puzzle mode: if the game over was `puzzleCleared` (all 50 cleared) →
  `quitToMenu()`; otherwise (OUT OF MOVES) → retry the SAME stage
  (`setupPuzzleStage()` with the current puzzleStage, moves reset). Keep
  `startGame(gameMode)` for zen/battle.
- `triggerGameOver()` puzzle titles (line 1615) stay: `puzzleCleared` →
  "ALL PUZZLES CLEARED!", else "OUT OF MOVES!".

### 8. Stage authoring rules (the 50 stages)

Read STANDARD_ORIENTATIONS + the roll mapping above and hand-trace EVERY
solution. Pre-placed adjacent groups of 3+ identical top faces sink on the
first move (checkAllMatches runs after every move) — use this deliberately:

- **Early stages** (1–5): small boards (5x5), 2–4 dice, ONE pre-placed cluster
  of 3+ same face, solution = exactly 1 move (any legal move activates the
  cluster), budget 2.
- **Stages 6–12**: 5x5–5x7, 4–6 dice, one pre-placed cluster PLUS one die that
  must be rolled/slid into a position to complete a second cluster,
  solution 2–3 moves, budget 4–5.
- **Stages 13–20**: 5x7–7x7, 5–8 dice, 2 clusters, some rolls to create
  matches, solution 4–6 moves, budget 7–8.
- **Stages 21–30**: 7x7, 7–10 dice, chained phases (a roll completes a group
  that sinks and frees a path for the next), solution 6–9 moves, budget 10–12.
- **Stages 31–40**: 7x7–9x5, 8–12 dice, introduce `walls` as obstacles,
  solution 9–13 moves, budget 13–16.
- **Stages 41–50**: up to 9x5 / 5x9, 10–16 dice, multi-phase solutions with
  walls, solution 12–18 moves, budget 16–22.

Rules for every stage:
1. Every `solution` step is legal as replayed (die at (x,y) exists, target
   cell empty at that moment, no rolling into walls/edges).
2. Dice needed by LATER solution steps must NOT be part of a pre-placed
   cluster (they'd sink early). Either no pre-placed clusters, or pre-placed
   clusters only activate on the final step.
3. `solution.length <= moves` with >= 1 spare.
4. No stage may be trivially impossible: the board size must have enough empty
   cells for all moves, and walls must not box dice into corners they must
   leave (check by tracing).
5. Difficulty must be monotonic-ish: never put a harder layout before an easier
   one; later stages are longer/more dice/walls.

## Acceptance checks (run by the requester, not you)

1. `scripts/verify-puzzle-stages.js` (written by the requester after your build)
   replays every stage's solution in headless Chrome: 50/50 must clear the
   board within budget. This is the gate — if ANY stage fails, the whole
   requirement is FAILED and you will get a fix request listing the exact
   failing stages.
2. Orchestrator `python3 orchestrator.py --mode once` must stay PASSED
   (zen/battle unaffected; no console errors).
3. Manual: PUZZLE MODE → select screen shows 50 tiles with correct lock state;
   resume works after clearing stages; OUT OF MOVES → PLAY AGAIN retries same
   stage; ALL CLEARED → PLAY AGAIN returns to menu.

## Files you may touch

- `game.js` (puzzle logic, Die constructor, triggerRoll/Slide, triggerGameOver,
  retry handler, puzzleMaxStages)
- `puzzle-stages.js` (NEW — the 50 stages; data only)
- `index.html` (script tag for puzzle-stages.js BEFORE game.js; puzzle select
  overlay; HUD label default)
- `style.css` (select screen + tile styles)

Do NOT touch: `.hermes/`, `test_output/`, `golden/`, `orchestrator.py`,
`tests/playtester.js`, `requirements/` other files. Do NOT git commit. Do NOT
run the orchestrator/playtester or any browser — no Chrome in your sandbox;
verification is the requester's job. No research, no curl, no web search —
everything needed is in this file and game.js.
