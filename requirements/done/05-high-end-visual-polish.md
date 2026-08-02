---
title: "High-end immersive visual polish: nebula background, geometry depth, dynamic light, particle trails, pulsing circuitry"
priority: 1
---

Push the visual quality to a true high-end, immersive aesthetic. All five items below must land in the current Three.js r128 game (devil-dice). Read game.js fully first — it already has a nebula background, bloom composer, circuit traces, and glassmorphism UI from previous requirements. Extend those, do not rebuild.

## Project conventions (MANDATORY)

- `"use strict";` at the top of game.js; `var` not `let/const`; Three.js **r128** single-file CDN (`three.min.js`) + non-module `examples/js/...` script tags in index.html — NO ES modules, NO import maps.
- Keep `window.autoGameState` / `window.currentFPS` automation hooks at the bottom of game.js exactly where they are.
- No external texture/image assets — everything procedural (canvas textures, shaders). CDN example scripts are allowed (jsdelivr three@0.128.0 `examples/js/...`).
- Do NOT touch post-processing/bloom tuning (it's dialed in), do NOT do general 60fps render-cost optimization work (parked), do NOT touch `getGridCellFromPointer`, the hold-drag path, `getSwipeDirection` (just fixed), DIRECTIONS, Die.roll/slide, or gameplay rules.
- Do NOT touch `.hermes/`, `test_output/`, `golden/`, `requirements/` (leave this file alone).
- Do NOT run orchestrator.py or the playtester (no Chrome in the sandbox — they will false-fail). Implement + syntax-check only: `node -e "new Function(require('fs').readFileSync('game.js','utf8'))"`.
- Do NOT git commit.
- Performance: the game must keep running at interactive framerates on modest GPUs. REUSE buffers (no per-frame allocations in hot loops), keep particle counts modest (< 200 live particles), keep the nebula on its low-res render target trick, and do NOT enable `renderer.shadowMap` (real shadow maps would tank software-GL FPS — achieve "shadows/highlights" via light falloff + emissive response instead).

## Item 1 — Fix background clipping + upgrade nebula shader

- **Bug:** there is a visible clipping plane / hard edge on the right side of the background. Root cause: the nebula is a single plane (`nebulaMesh`, plane at z=-16, scaled 2.4x by camera frustum halves at lines ~481-572) — a flat plane cannot cover the view frustum at every aspect ratio / camera angle, so an edge shows.
- **Fix:** render the nebula as a **fullscreen quad** that always covers the canvas regardless of aspect ratio or camera angle. Recommended approach: keep the low-res render target + blit quad pattern (it exists and is fast), but make the *blit* quad a true fullscreen NDC quad (ortho -1..1, `depthTest:false, depthWrite:false`, renderOrder -10) so it can never show an edge; and upgrade the *nebula shader itself* to fullscreen NDC coordinates (fragcoord/aspect-based uv, no world-plane math). Alternative (only if the blit approach fights you): a large background sphere (`SphereGeometry`, `THREE.BackSide`) that encloses the camera and follows it.
- **Shader upgrade:** replace the current sparse static dots with a flowing deep-space nebula: 2-3 octaves of smooth value noise or simplex noise (implement the noise function IN the GLSL — no external includes), mixing deep purples (#1a0b3a-ish), blues (#0a2a5e-ish), and faint magentas (#6a1b6a-ish). Animate slowly with the existing `uTime` uniform (slow drift + slow rotating noise domain, e.g. `uTime * 0.02-0.05`). Keep a handful of subtle twinkling stars on top (existing star code can be reused/kept). Must look like a premium game background, not a flat gradient.
- Keep `uAspect` or compute aspect in the shader so the noise is not stretched.

## Item 2 — Geometry depth & edge highlights

- **Board:** currently looks like a 2D plane. Extrude it into a shallow 3D platform: use a `THREE.BoxGeometry` with a small height (~0.25-0.4 units, choose to look right with the existing camera/grid spacing), or a PlaneGeometry + extruded rim mesh. Add a **faint glowing rim** to the board edges: `THREE.EdgesGeometry` + `THREE.LineBasicMaterial` (magenta/cyan, transparent, low opacity ~0.35-0.5), or an emissive edge material on a slightly-larger box. It must read as "glowing obsidian platform edges" from the isometric camera.
- **Dice bevels:** dice currently use sharp `BoxGeometry`. Swap to a rounded/beveled look so edges catch light like polished obsidian. First CHECK whether `RoundedBoxGeometry` exists in the r128 non-module examples (`https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/geometries/RoundedBoxGeometry.js` — verify with curl before adding the script tag). If it exists: add the script tag to index.html and use it (small radius ~0.06-0.1 relative to die size). If it does NOT exist at r128: simulate beveled edges with a canvas-generated normal map on the die texture (bump the pips slightly too) — do NOT hand-write a custom geometry.
- **Die material:** increase roughness slightly (0.3 → ~0.4) and add a **subtle envMap** so dice reflect the ambient nebula colors. Generate the envMap procedurally from a canvas: a tiny 6-face CubeTexture (or a PMREM-style gradient) of deep purple/blue/magenta gradients matching the nebula palette — no external assets. Apply the same envMap to all six die materials (and optionally the board). Keep emissive pips as they are (they carry game state).

## Item 3 — Dynamic lighting (follows the active die)

- Add a soft **magenta/pink PointLight** (e.g. `0xff2fd6`-family, moderate intensity, range ~10-14, decay) positioned slightly ABOVE the currently-active die. Each frame in the render loop, update its position to track the active/controlled die (same die the player moves; when the active die changes, the light follows; keep it valid during die.move/roll animations by sampling the die's current world position).
- It should cast subtle dynamic highlights on the surrounding dark dice and visibly illuminate the circuit traces on the board directly beneath the active die.
- Do NOT enable real shadow maps (perf — see conventions). The "shadowing" feel comes from the light's falloff + the board emissive response.
- There is already a static ambient magenta PointLight (line ~400) — keep it; the new light is the *dynamic* follower.

## Item 4 — Particle trails for active movement

- Implement a `THREE.Points`-based emitter that tracks the active die. When the die moves or rolls (slide, roll, or even a hard flick), spawn a burst of glowing magenta particles at the die's position; particles drift slightly outward/upward and **fade out over 0.5-1.0s**, then are recycled.
- Implementation notes: one pre-allocated `THREE.BufferGeometry` with fixed capacity (e.g. 256 particles), `THREE.PointsMaterial` with `transparent:true, blending:THREE.AdditiveBlending, depthWrite:false`, small size (~0.08-0.15), vertex-color or single magenta color. Update positions/alpha in the render loop (CPU-side is fine at this count). Add a spawn hook into the die move/roll completion paths (`Die.move`/`Die.roll` callbacks or the active-die update code) and also a small continuous trickle while the active die is being dragged/held.
- No per-frame allocations; wrap-around recycling when the ring buffer fills.

## Item 5 — Pulsing circuitry

- The board's circuit traces must feel alive: pass a **time uniform** to the board/circuit material and pulse with a sine wave — animate the **opacity or emissive intensity** of the circuit lines (e.g. `0.55 + 0.45 * sin(uTime * speed)` with a slow speed ~1.2-2.0, optionally phase-shifted per trace region for a "signal travelling" feel).
- If the circuit traces are a canvas texture on a standard material: use `emissiveIntensity` modulated per frame (cheap) OR convert the circuit layer to a `ShaderMaterial`/`OnBeforeCompile` hook with a `uTime` uniform (preferred if clean). There is already a `circuitPulse` variable and `circuitTraceMat` — extend that mechanism rather than duplicating.
- Keep the pulsing subtle (it must not wash out the pip state / active-die magenta aura).

## Deliverable & report

When done, report:
1. Per-item summary of what changed (with function/line anchors)
2. Any new script tags added to index.html (and whether RoundedBoxGeometry existed at r128)
3. Per-frame cost estimate for each new system (lights/particles/shader) and how you kept allocations out of hot loops
4. Risk areas (things that might break the playtester's drift check, console errors, or visual regressions)
