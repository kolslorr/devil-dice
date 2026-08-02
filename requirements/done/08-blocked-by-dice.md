---
title: "Match original Devil Dice rules: dice are blocked by other dice — no chain push on hold-drag"
priority: 1
---

User report: the original Devil Dice only allows moving ONE die at a time, and the die is effectively BLOCKED by other dice in its drag path. Our implementation currently allows CHAIN DRAGGING — dragging a die into an occupied cell pushes the whole lane of dice forward (`_execPush`). Fix to match the original: a die cannot move into an occupied cell at all.

## Current behavior (diagnosed — do not re-investigate)

- `Die.prototype.roll` (~line 401-406, the FLICK path): already correct — `if (grid[ex][ey] !== null) { this.state = 'normal'; AudioEngine.playMove(); if (onComplete) onComplete(); return; }` — occupied target = blocked, no movement. Do NOT change this.
- `Die.prototype.slide` (~line 430-449, the HOLD-DRAG path): deviates. `if (grid[tx][ty] === null) { this._execSlide(direction, onComplete); return; }` then for an occupied target it builds a chain of normal active dice along the direction and calls `this._execPush(direction, chain, onComplete)` — pushing the whole lane if it ends in an empty cell. THIS is the chain-dragging to remove.

## The fix (exact)

1. In `Die.prototype.slide`, replace the entire chain-push section (from `// Occupied target: try to push the whole lane...` through `this._execPush(direction, chain, onComplete);`) with the SAME blocked handling as roll:

```js
if (grid[tx][ty] !== null) { AudioEngine.playMove(); if (onComplete) onComplete(); return; }
```

   (Keep the out-of-bounds check and the `_execSlide` empty-target branch exactly as they are. Keep the early returns for `state !== 'normal'` and `cellType === CELL_TYPE.LOCKED`.)

2. DELETE `Die.prototype._execPush` entirely (~lines 459-494) — it becomes unreachable dead code. Verify nothing else references `_execPush` before deleting (grep first; only `slide` should reference it).

## Constraints

- Change ONLY `Die.prototype.slide` (+ delete `_execPush`). Do NOT touch `roll`, `_execSlide`, input handlers (`onPointerMove`/`onPointerDown`/`onPointerUp`), `getSwipeDirection`, `getGridCellFromPointer`, `raycastDie`, the req-07 diagonal fallback in onPointerMove, rendering, spawning, matching, or any other gameplay system.
- `"use strict";`, `var` not let/const, Three.js r128. Keep automation hooks (`window.autoGameState`/`currentFPS`/`gridToScreen`) untouched.
- No index.html/style.css changes. No git commit. Do NOT run orchestrator.py or the playtester. Syntax-check only: `node -e "new Function(require('fs').readFileSync('game.js','utf8'))"`.
- Do NOT web-search, do NOT print large file chunks. Implement immediately.

## Report when done

1. The exact diff (slide change + _execPush removal)
2. Confirm nothing else references _execPush and that roll is untouched
