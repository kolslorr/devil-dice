---
title: "Puzzle mode: redesign all 50 stages for variety — no two stages feel the same"
priority: 1
---

# Puzzle Stage Variety Redesign

## Problem (user's words)

"The puzzle feels lacking. Stage 1 to 5 feels almost identical, while stage 6 to
10 feels the same." The current 50 stages were authored too formulaically —
stages 1–5 are all "4 dice, 1-move, one pre-placed straight cluster of 3s",
stages 6–10 all "5–6 dice, 2–3 moves, one cluster + one roll". Every stage must
feel distinct.

## Scope

Rewrite **only `puzzle-stages.js`** (the 50-entry `PUZZLE_STAGES` array). Do NOT
touch game.js or any other file. The format stays compatible:

```js
{
  board: { cols: 5, rows: 5 },
  moves: 2,
  walls: [{x,y}, ...],            // may be empty
  dice: [{x, y, v, rot}],         // v = top face 1..6, rot = Y-rotation 0..3
  solution: [{x, y, dir, type}],  // type: 'roll' (default) or 'slide'
}
```

NEW: solution steps may add `type: 'slide'` (or omit it = 'roll'). A slide
moves the die one cell WITHOUT changing its faces (`triggerSlide`); a roll
changes position AND faces per the game's roll mapping (game.js lines 582–585).
The engine already supports both (`triggerSlide` exists) — no game.js changes.
The requester's replay probe (`scripts/verify-puzzle-stages.js`) will execute
each step via `triggerRoll` or `triggerSlide` depending on `type`.

## Non-negotiable correctness rules (same as req 12)

1. Replaying `solution` must clear the board (zero active dice) within `moves`
   (budget = solution length + >= 1 margin).
2. Every step legal as replayed: the die at (x,y) exists and is 'normal' at
   that moment; the target cell is in-bounds and empty (no die, no wall);
   dice needed by LATER steps must not be part of a pre-placed cluster that
   sinks early.
3. All 50 stages remain monotonic easy→hard overall (budget/solution length
   trend up), but see the variety rules below — monotonicity is loose, variety
   is the point.

## Variety rules (the heart of this requirement)

Author each stage as a DISTINCT puzzle. Follow ALL of these:

### A. Puzzle archetypes — distribute ALL of these across the 50 (no band may
use only one):

1. **Activation** — pre-placed 3+ cluster(s); one move triggers the clear.
2. **Completion** — roll a die so its NEW top face matches a neighbor group.
3. **Slide-in** — slide a die into a slot to complete a group (faces unchanged).
4. **Build** — NO pre-placed cluster; roll dice to CREATE the first 3+ group.
5. **Chain** — a group sinks and frees a path; a die then moves through the gap
   to complete the next group (sequential phases).
6. **Obstacle** — walls channel movement; the solution weaves around them.

Archetype mix guideline: stages 1–10 = activation/completion/slide-in;
11–30 add build + chain; 31–50 add obstacle + longer chains. Within each band
of 5–10 stages, use at least 3 different archetypes.

### B. Cluster shapes — use varied polyomino shapes, not just straight lines:
line-3, line-4, L, mirrored L, T, 2x2 box, S/Z, plus, staircase, corner,
diagonal domino pairs. Do NOT repeat the same shape for more than 2 stages in
a row. Pre-placed clusters of 4+ dice should appear at varying angles/orientations.

### C. Face values — mix values across stages. Early stages may use one value
per stage (but ROTATE which value: 2, 3, 4, 5, 6 — not all 3s). From stage
~13 onward many stages must contain TWO OR MORE different top faces in the
layout (e.g. a 4-cluster AND a 5-cluster in the same puzzle). Every value 1–6
must appear as a top face somewhere in the set. Dice with top=1 are allowed
(the 1s chain/absorb mechanic adds variety).

### D. Move-type mix — at least 12 of the 50 stages must use >= 1 slide step in
their solution (type:'slide'); the rest rolls. Slide-based puzzles should feel
different (positioning, no face change).

### E. Board sizes — vary WITHIN every band, not banded all-same: mix 5x5 with
5x7 in stages 1–10; mix 5x7/7x7 in 11–20; mix 7x7/9x5 in 21–35; mix 9x5/5x9 in
36–50. A 7x7 stage may appear as early as stage ~8; a 5x5 may appear as late
as ~14. No two adjacent stages share the same board size.

### F. Wall patterns (stages 31–50) — vary: single pillars, corridor walls,
room dividers, corner notches, diagonal walls. Walls must never make a stage
unsolvable (trace the solution).

### G. Global uniqueness — no two stages may share the same tuple of
{board size, sorted die positions, sorted values, wall positions, solution
length, move-type mix}. Every stage must differ from its predecessor by at
least two of: shape, values, archetype, board size, move type.

## Self-check before finishing

The requester will verify (a) all 50 solutions replay-clear in the real game,
and (b) a variety audit (pairwise distinctness, value coverage, slide-step
count, board-size mixing, archetype spread). Write a quick Node script to
print these stats and iterate your stages until they pass before you finish.
Do NOT claim variety that isn't in the data.

## Files

- `puzzle-stages.js` ONLY. No commits. No orchestrator/browser runs.
