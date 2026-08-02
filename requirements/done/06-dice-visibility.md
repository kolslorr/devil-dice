---
title: "Dice visibility: make dice read as solid, high-contrast objects with clearly visible pips"
priority: 1
---

User report: "make the dice less translucent. Right now it appears to be blended into the background and it's difficult to see the dots on the dice."

## Root cause (already diagnosed — do not re-investigate)

1. `PALETTE.normalDie` (game.js ~line 49): `bg: '#0b0814'` is near-black — almost identical to the board tiles (`#0d0a16`/`#120e1e`) and board floor (`0x05030c`). The die body has no luminance separation from the board → it reads as "blended/translucent."
2. `getDiceMaterials` faceMat (~line 326): `metalness: 0.7` makes the body 70% reflections — the envMap reflects the dark scene, so even a lighter texture would be washed out. `envMapIntensity: 0.55` adds more dark reflection.
3. Pips are drawn with `shadowBlur: 8` glow (`getDiceTexture` ~line 193) and an emissive bloom feed — on a near-black body the glowing dots lack contrast to read crisply.

## The fix (exact values — implement exactly)

1. **Brighten the normal die palette** (PALETTE.normalDie only; leave sinking/rising/locked/hover palettes alone):
   - `bg`: `'#0b0814'` → `'#3a2d52'` (deep purple-charcoal, clearly lighter than the board but still dark/premium)
   - `border`: `'#1b2540'` → `'#7a68b8'` (visible violet edge so each die has a crisp silhouette)
   - `pips`: keep `'#00ff88'` (it has strong contrast against the new purple body)
2. **Define the pips crisply** in `getDiceTexture` (~line 193-197): before filling each pip, stroke a thin dark ring around it — `ctx.strokeStyle = 'rgba(8,5,16,0.85)'; ctx.lineWidth = 3;` and `ctx.stroke()` on the same arc path — so dots read as distinct solid discs against the lighter body. Keep the existing pip glow (`shadowBlur`) but consider reducing it to 5 for crisper edges.
3. **Make the material solid, not glassy** in `getDiceMaterials` faceMat (~lines 331-334):
   - `roughness`: 0.4 → 0.5
   - `metalness`: 0.7 → 0.3 (diffuse body color dominates; this is the key "less translucent" change)
   - `envMapIntensity`: 0.55 → 0.25 (keep a hint of nebula reflection, don't wash out the body)
   - `emissiveIntensity` for the normal state: 2.0 → 2.4 (pips pop against the lighter body)
4. Optionally soften the face edge-darkening gradient in `getDiceTexture` (~line 192, `rgba(0,0,0,0.35)` → `0.22`) so the lighter body doesn't get re-darkened at the face edges.

## Constraints

- `"use strict";`, `var` not let/const, Three.js r128, no ES modules. Keep `window.autoGameState` / `window.currentFPS` / `window.gridToScreen` hooks untouched.
- Do NOT touch: board, background/nebula, bloom, lights, trails, circuit, UI, gameplay, `getSwipeDirection`/input, `getDiceEmissiveTexture`, `getDiceNormalTexture` (normal map has its own canvas, leave it).
- Texture cache is keyed by face value/state/rot — changing PALETTE values is safe on reload (fresh cache). Do NOT add a cache-busting key.
- This is a CLARITY fix — a targeted palette + material change. Do not restructure texture generation, do not add new systems, do not touch index.html/style.css.
- Implement + syntax-check ONLY: `node -e "new Function(require('fs').readFileSync('game.js','utf8'))"`. Do NOT run orchestrator.py or the playtester. Do NOT git commit. Do NOT touch `.hermes/`, `test_output/`, `golden/`, `requirements/`.
- Do NOT web-search, do NOT curl, do NOT print large file chunks. Implement immediately.

## Report when done

1. Exact diff summary (which palette values, which material params, pip-ring code)
2. Per-state impact (sinking/rising/hover dice now share roughness/metalness/envMapIntensity — note any visual side effects on those states)
3. Risk areas for the drift check
