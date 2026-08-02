---
title: "Fix hold-drag diagonal dead-zone: dragging a die diagonally (e.g. top-left) does nothing"
priority: 1
---

User report: "drag and drop gesture has regressed. Dragging top left direction is especially buggy."

## Root cause (diagnosed + reproduced — do not re-investigate)

In `onPointerMove` (game.js ~line 1122), the hold-drag branch only slides the die when the pointer enters a cell that is EXACTLY one orthogonal step from the last cell:

```js
var gdx = cell.gx - inputState.lastGX, gdy = cell.gy - inputState.lastGY;
var dir = null;
if (gdx === 1 && gdy === 0) dir = 'east';
else if (gdx === -1 && gdy === 0) dir = 'west';
else if (gdx === 0 && gdy === 1) dir = 'south';
else if (gdx === 0 && gdy === -1) dir = 'north';
if (dir) { triggerSlide(inputState.curDie, dir); inputState.lastGX = cell.gx; inputState.lastGY = cell.gy; }
```

A DIAGONAL pointer move (e.g. screen top-left = world north-west) makes the pointer jump from cell (x,y) straight to (x-1,y-1) — the projected path never enters an intermediate orthogonal cell. `gdx=-1, gdy=-1` matches none of the four branches → `dir = null` → **the die never slides**. Reproduced headless: hold-drag from (1,1) to the (0,0) screen position → die stays put, no console errors.

## The fix (exact)

In the hold-drag branch of `onPointerMove`, AFTER the four orthogonal checks, add a fallback that resolves ANY non-orthogonal delta (diagonal single-step OR multi-cell jumps from fast drags) to the dominant world axis:

```js
else if (gdx !== 0 || gdy !== 0) {
    if (Math.abs(gdx) >= Math.abs(gdy)) dir = gdx > 0 ? 'east' : 'west';
    else dir = gdy > 0 ? 'south' : 'north';
}
```

This is the SAME dominant-axis philosophy as `getSwipeDirection` (req 04): a top-left drag resolves to west or north (whichever the pointer is closer to), the die slides one orthogonal step, and as the user keeps dragging the die walks the staircase toward the pointer. Keep `inputState.lastGX/lastGY = cell.gx/cell.gy` EXACTLY as-is (pointer cell) — do not change the orthogonal behavior or the last-cell tracking semantics.

## Constraints

- Change ONLY this one spot in `onPointerMove`. Do NOT touch `getSwipeDirection`, `getGridCellFromPointer`, `raycastDie`, `triggerSlide`/`triggerRoll`, `Die.prototype.slide`/`_execSlide`/`_execPush`, gameplay rules, rendering, or anything else. Do NOT touch the flick path.
- `"use strict";`, `var` not let/const, Three.js r128. Keep automation hooks untouched.
- No index.html/style.css changes. No git commit. Do NOT run orchestrator.py or the playtester. Syntax-check only: `node -e "new Function(require('fs').readFileSync('game.js','utf8'))"`.
- Do NOT web-search, do NOT print large file chunks. Implement immediately.

## Report when done

1. The exact diff (the one added else-if branch)
2. Confirm nothing else changed
