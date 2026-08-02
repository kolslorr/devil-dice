---
title: "Fix bloom blurriness / overblown rendering — restore crisp geometry, keep subtle glow"
priority: 1
---

The visual effects added in the previous requirement render extremely blurry and
overblown. The cubes have lost their geometry definition, and the glowing pips
are bleeding light over everything.

Refactor the Three.js rendering and post-processing setup to fix the blurriness
and restore crisp geometry while keeping a subtle glow. Specific adjustments
(the end result is binding; adapt if the codebase differs):

### 1. Fix mobile resolution & sharpness
- Ensure high-DPI scaling on mobile screens by explicitly setting:
  `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));`
  `composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));`

### 2. Tweak UnrealBloomPass parameters
- Current bloom is too intense. Adjust
  `UnrealBloomPass(resolution, strength, radius, threshold)` to keep glow
  tight and subtle:
  - threshold: increase to 0.8 – 0.9 (so ONLY the bright green pips glow, not
    cube bodies or board surface)
  - strength: reduce to 0.4 – 0.7 (prevents light wash/bleed)
  - radius: lower to 0.2 – 0.4 (keeps aura tight around emissive edges)

### 3. Apply tone mapping & exposure
- Enable tone mapping on the renderer to handle bright neon highlights cleanly
  without blowing out surrounding pixels:
  `renderer.toneMapping = THREE.ACESFilmicToneMapping;`
  `renderer.toneMappingExposure = 1.0;` (tune down if still too bright)

### 4. Crisp material adjustments
- Adjust base dice material so dark cube edges stay defined:
  - Base cube: dark metal/roughness (roughness 0.3, metalness 0.7)
  - Pips: emissiveIntensity controlled to 1.5 – 2.0 (instead of extreme values)
    so pip shape stays sharp and legible

## Hard constraints

- Gameplay logic, controls, automation hooks unchanged.
- Playtester must pass: 60 FPS on the 450x850 mobile viewport, no console
  errors, visual drift vs golden baseline within 5%.
- Bloom stays (tuned), do not remove it. Do not remove the nebula/stardust/
  circuit-trace/aura features from the previous requirement.
- Project conventions: "use strict", var not let/const, Three.js r128 CDN.
- Cleanup (dispose geometry/material) in quitToMenu() AND triggerGameOver().
- Keep window.autoGameState / window.currentFPS hooks.
