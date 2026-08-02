---
title: "Zen mode: more prominent, varied background fireworks with big combo payoff (Tetris Effect vibe)"
priority: 1
---

In Zen mode, make the background firework effect more prominent with more variety.

Specifically:
1. More prominent: bigger, brighter, more frequent background fireworks in Zen mode.
2. More variety: multiple firework types/shapes (e.g. peony burst, ring, willow trails, double-break), varying colors, sizes, speeds.
3. Combo dopamine hook: if the player makes a combo, trigger a BIG special effect as a reward (large multi-burst fireworks, screen-scale flash, extra particles) — the bigger the combo, the bigger the payoff.
4. Overall vibe: emulate the game "Tetris Effect" — ambient, euphoric, rhythmic, screen-filling visual celebration.

Constraints (project conventions):
- Keep "use strict" at top of game.js
- Use var, not let/const
- Three.js r128 API (no modules, CDN version)
- Use THREE.BufferGeometry + BufferAttribute for particles, AdditiveBlending for glow
- Set both depthWrite: false AND depthTest: false on background particle materials
- Visible sizes: ambient >= 0.3, bursts >= 0.8, opacity >= 0.7
- Clean up all timers/intervals/particles in quitToMenu() and triggerGameOver()
- Keep automation hooks (window.autoGameState, window.currentFPS) at bottom of game.js
- Keep mobile touch + keyboard compatible, keep 60 FPS
