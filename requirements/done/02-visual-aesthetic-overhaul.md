---
title: "Full visual aesthetic overhaul — Tetris Effect-inspired (bloom, nebula, glass board, neon dice, glassmorphism UI)"
priority: 1
---

Upgrade the visual aesthetic of the existing Three.js/HTML/CSS codebase for the
mobile web "Devil Dice" game. Gameplay logic is already complete and must not
change. The end result below MUST be achieved; the technical implementation
details are suggestions only — adapt them to the existing codebase as needed.

## Required visual upgrades

1. **Post-processing (crucial)** — global bloom so neon elements (dice pips,
   active dice, UI borders) glow realistically without blowing out darker board
   elements. Include a subtle vignette darkening the screen edges.

2. **Background & environment** — replace static background with a dynamic,
   swirling deep-space nebula (deep purples, blues, cyans). Add a Three.js
   Points particle system behind the board simulating glowing stardust drifting
   continuously via sine-wave functions, varying in size and opacity.

3. **Game board material** — dark polished obsidian / tinted glass look
   (slightly reflective, high smoothness). Embed a subtle, pulsing emissive
   layer beneath the surface that looks like geometric circuit-board traces.

4. **Dice material & effects** —
   - Standard dice: very dark sleek cubes; pips use an emissive map with bright
     neon green so they interact with the bloom pass.
   - Active/controlled dice: switch to a highly emissive neon magenta/pink
     material.
   - Energy aura: localized dynamic particle emitter / trail on the active
     magenta dice that sweeps outward as they move.

5. **UI overhaul (CSS/HTML)** — minimalist glassmorphism: thin glowing neon
   borders (box-shadow + backdrop-filter). SCORE / HIGH SCORE containers: crisp
   futuristic monospace fonts, subtle magenta text shadow. BOARD FULLNESS bar:
   vibrant CSS gradient green→yellow→pink, with a small CSS animation / canvas
   overlay for particle dispersal at the leading edge. Pause button: clean
   glowing neon pause icon inside a thin circular glowing border.

## Hard constraints

- Gameplay logic, controls, and automation hooks must keep working.
- Playtester expectations must still pass: 60 FPS, no console errors,
  zenEffectsVerified (zen ambient particles active, bursts spawn), visual
  drift vs golden baseline within 5%.
- Optimize for mobile browser performance: bloom is heavy on mobile — use
  resolution scaling (e.g. half-res composer or adjustable bloom strength /
  thresholds) so FPS stays at 60 on the 450x850 mobile viewport. Do NOT remove
  bloom entirely to pass — tune it.
- Project conventions: keep "use strict"; use var not let/const; Three.js
  r128 CDN (no modules). Post-processing requires adding r128 example scripts
  to index.html (examples/js/postprocessing/EffectComposer.js, RenderPass.js,
  ShaderPass.js, UnrealBloomPass.js + their shader deps) — CDN version matching
  r128.
- Existing background particle functions (initZenEffects, spawnZenBurst,
  updateZenEffects, clearZenEffects, combo fireworks) must keep working and be
  cleaned up properly in quitToMenu() AND triggerGameOver() (dispose geometry
  AND material, no leaks).
- Keep window.autoGameState / window.currentFPS automation hooks at bottom.
- Keep mobile touch + keyboard compatible.
