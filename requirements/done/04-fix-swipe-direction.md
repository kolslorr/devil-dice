---
title: "Fix swipe/flick direction mapping — drags don't match visual direction (isometric camera)"
priority: 1
---

Drag and moving of cubes feels inaccurate ~50% of the time. Sometimes when the
player drags up on screen, the die moves right (or another visually wrong
direction).

## Root cause (confirmed by analysis)

The camera is an isometric/angled orthographic camera:
`camera.position.set(dist * 0.45, h, dist * 0.6); camera.lookAt(0, -0.3, 0)` in
`setupOrthoCamera()` (~37 deg yaw). The screen axes do NOT align with the world
grid axes.

But the swipe/flick path maps raw screen-space deltas straight to compass
directions, ignoring the camera rotation:

```js
function getSwipeDirection(dx, dy) {
  var ang = Math.atan2(dy, dx), deg = ang * (180 / Math.PI);
  if (deg < 0) deg += 360;
  if (deg >= 0 && deg < 90) return "east";
  if (deg >= 90 && deg < 180) return "south";
  if (deg >= 180 && deg < 270) return "west";
  return "north";
}
```

So "up on screen" is interpreted as world-north, but on the tilted camera the
ground-plane direction of that swipe is rotated ~37 deg — the die rolls along
the wrong grid axis. The hold-and-drag path is ALREADY correct because it
raycasts screen points onto the Y=0 grid plane (`getGridCellFromPointer`); only
the quick-flick path (`onPointerUp` → `getSwipeDirection`) is broken.

## Required fix

Make direction mapping camera-aware so both paths agree:

1. **Project the swipe onto the grid plane.** In `getSwipeDirection` (or the
   swipe handler), unproject the swipe's start and end screen points onto the
   Y=0 plane using the same raycaster technique as `getGridCellFromPointer`
   (already in the file): build a `THREE.Raycaster`, `setFromCamera` with NDC
   coords, intersect with `new THREE.Plane(new THREE.Vector3(0,1,0), 0)`, and
   read `pt.x` / `pt.z`.
2. **Quantize the plane-space delta to grid directions.** World X maps to
   east(+)/west(-), world Z maps to south(+)/north(-) — matching
   `DIRECTIONS = { north:{dx:0,dy:-1}, south:{dx:0,dy:1}, east:{dx:1,dy:0},
   west:{dx:-1,dy:0} }` and the existing `getGridCellFromPointer` grid math
   (`gx = round(pt.x/GRID_SPACING + ...)`, `gy = round(pt.z/GRID_SPACING +
   ...)`). Pick the dominant axis by comparing |deltaX| vs |deltaZ|.
3. **Keep a fallback** to the old angular mapping if the plane intersection
   fails (e.g. swipe ends off-board over empty space), so a swipe never
   becomes a no-op.
4. Do NOT change `getGridCellFromPointer`, the hold-drag path, `DIRECTIONS`,
   `Die.prototype.roll/slide`, or any gameplay rules. Only the flick/swipe
   direction resolution changes.

## Hard constraints

- Gameplay logic, controls, hooks (window.autoGameState, window.currentFPS)
  unchanged.
- Keep "use strict", var not let/const, Three.js r128.
- Do NOT touch the post-processing / bloom / nebula / material code — the 60fps
  optimization is parked; leave rendering exactly as it is.
- Do NOT run orchestrator.py or the playtester (Chrome cannot launch in your
  sandbox). Implement + syntax-check only:
  `node -e "new Function(require('fs').readFileSync('game.js','utf8'))"`.
- Do NOT git commit. Do NOT touch .hermes/, test_output/, golden/,
  requirements/ files (the requirement file itself stays).

When done, report: (1) the new direction-resolution code, (2) how the plane
projection handles edge cases (off-board swipes, tiny swipes), (3) any risk
areas.
