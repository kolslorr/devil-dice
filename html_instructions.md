Here is the updated, production-ready Markdown specification document. It has been fully converted from the Godot architecture to a native Web stack layout, utilizing **Three.js** for 3D rendering and the unified **Pointer Events API** for cross-platform touch and mouse inputs.

---

# Game Specification: Minimalist Touch-Native Dice Puzzle (Web/HTML5 Edition)

## 1. Executive Summary & Aesthetic

* **Core Concept:** A minimalist, grid-based 3D action-puzzle game inspired by *Devil Dice* / *XI [sai]*, engineered for modern mobile touch-screen and desktop web browsers.
* **Key Shift:** Completely removed the character avatar. The user interacts **directly** with the dice grid using gestures, turning a character-navigation game into a high-fidelity, tactile, kinetic puzzle.
* **Aesthetics:** Clean, flat, minimalist, or vector-neon styles (similar to *Threes!* or *Monument Valley*). Clean 3D cube geometry rendered inside an HTML5 `<canvas>` with soft lighting.

---

## 2. Core Game State & Logic Architecture

The visual layer is rendered in 3D, but the underlying logical simulation must be a strict, deterministic **2D Grid Array Matrix** to ensure flawless puzzle execution and predictable AI behavior. Do not rely on physics engines for state tracking.

### 2.1 The Matrix State Object

Each cell in the $7 \times 7$ grid contains an object tracking its state:

* `Type`: Empty (`0`), Active Die (`1`), Locked Block (`2`).
* `Orientation`: A tracking object representing a standard 6-sided die, where opposite sides always add up to 7 ($1 \leftrightarrow 6$, $2 \leftrightarrow 5$, $3 \leftrightarrow 4$).
* Orientation values tracked dynamically: `Top_Face`, `North_Face`, `East_Face`.

### 2.2 Match & Chain Logic

1. **Trigger:** Evaluated the exact millisecond any die completes a motion (roll or slide).
2. **Flood-Fill Scan:** Read the `Top_Face` of the moved die. Recursively scan orthogonally adjacent active dice.
3. **Match Condition:** If the number of connected dice with identical `Top_Face` values matches or exceeds the value itself (e.g., a cluster of four `4`s, or three `3`s), a match is made.
4. **Sinking State:** Matched dice lock into a temporary "sinking" animation state. During this countdown, other matching numbers slid or rolled into this cluster are absorbed, resetting the sink timer and increasing the combo chain.

---

## 3. Touch & Mouse Control Mechanics (Pointer Events)

To maintain unified support for both mobile touch and desktop mouse testing, the implementation must use the browser's native **Pointer Events API**. Gestures must natively distinguish between **Rolling** (changing face numbers) and **Sliding** (maintaining the top face).

### 3.1 Gesture Detection Logic

* **On `pointerdown`:** Record the starting coordinates `(startX, startY)` and spin up a `setTimeout` timer (e.g., 200ms).
* **On `pointerup`:** If the pointer is released *before* the 200ms timer fires and a displacement threshold (e.g., 20 pixels) is met, calculate the vector delta ($\Delta x$, $\Delta y$) to determine the **Swipe direction (Roll)**.
* **Hold to Slide:** If the 200ms timer fires *while the pointer is still held down*, trigger a visual glow/scale on the selected cube (and a lightweight haptic buzz via `navigator.vibrate` if available). Subsequent `pointermove` events track grid cell transitions for the **Drag (Slide)**.

### 3.2 Roll vs. Slide Execution

* **Swipe to Roll:** The die rolls exactly 90 degrees into an adjacent empty tile. The JS matrix updates the destination cell, clears the origin cell, and calculates the new `Top_Face`. Three.js interpolates a smooth 90-degree pivot rotation around the bottom edge using **Quaternions**, snapping precisely to the target angle on completion.
* **Hold & Drag to Slide:** The die slides smoothly across empty tiles *without rotating*, preserving its current `Top_Face` value. If it hits another die, it pushes it along the lane if there is open space at the end of the row/column.

### 3.3 UI Perspective Handling

* **Camera:** Three.js `OrthographicCamera` set to a fixed, low-angle tilted-down 3D perspective so players can see top and side faces clearly.
* **Input Vector Translation:** Screen-space swipes must map directly to grid axes (e.g., swiping straight up on the screen moves the die North on the grid matrix, eliminating diagonal ambiguity).

---

## 4. Game Modes

### 4.1 Zen Mode

* **Gameplay:** Relaxed, high-score focus mimicking modern *Tetris* endless modes.
* **Mechanic:** No timers or failing conditions from speed. Dice pop up from the floor at a relaxed pace or on a turn-per-swipe limit. Focuses entirely on building massive chains and cleaning the board efficiently.

### 4.2 Puzzle Mode

* **Gameplay:** Stage-based brain teasers.
* **Mechanic:** The player is given a pre-arranged layout of dice and a strictly limited number of Moves (Swipes/Drags). The goal is to clear the entire board down to zero dice within the move quota.

### 4.3 AI Battle Mode (Avatarless Single Player Vs.)

* **Layout:** Vertical Split UI via CSS Flexbox/Grid. The human player controls their grid on the lower 60% of the screen canvas. The computer AI controls an identical grid scaled down on the upper 40% of the screen canvas.
* **Visualizing the AI:** The computer's actions are shown via a minimalist telemetry overlay—a glowing ring targets the die the AI selects, followed by a swift vector trail showing its swipe direction. The dice roll/slide at a human-readable pace using standard linear interpolation (`lerp`).
* **Combat Loop:**
* **Attacking:** Completing a match on your board sends a CSS vector streak up to the AI's board, slamming down **Locked Blocks** (inverted color/blank unmovable cubes) onto random empty tiles on their grid.
* **Defending/Countering:** To shatter a Locked Block, a numbered die must be matched directly adjacent to it.
* **Win Condition:** The first board to overflow completely with no legal moves remaining loses the match.



---

## 5. Web Tech Stack Implementation Guidelines (For AI Prompting)

When instructing the AI tool to generate code, adhere to these web constraints:

* **File Architecture:** Aim for a clean, modular setup:
* `index.html`: Holds the canvas container, HUD, and includes Three.js via stable CDN.
* `style.css`: Manages responsive design, absolute overlays for UI, and layout boundaries.
* `game.js`: Contains the render loop (`requestAnimationFrame`), input tracking state, matching algorithms, and the AI decision loop.


* **AI Agent Ticks:** Use JavaScript's native `setInterval()` or a delta-time accumulator inside the main loop to control the AI's execution ticks (e.g., every 800ms on Medium difficulty). On tick, it parses the 2D grid array, scores potential orthogonal moves based on proximity to matching faces, and updates its grid array state accordingly.
* **Animation Stability:** Ensure all 3D mesh rotations snap exactly to increments of $\pi / 2$ at the end of every animation sequence to prevent float accumulation bugs.
