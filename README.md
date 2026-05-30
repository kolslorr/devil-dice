# Devil Dice 3D

A high-fidelity, responsive, 100% self-contained 3D recreation of the classic PlayStation game **Devil Dice** (known as **XI** in Japan), optimized for mobile devices (iOS/Android) and modern desktop web browsers.

This game is built with pure, lightweight **HTML5, CSS3, and modern ECMAScript/Three.js WebGL**. It runs entirely in the client with **zero external assets to download** (all textures and sound effects are generated procedurally in code!). This ensures instant load times, seamless offline play, and absolute reliability when packaged for native mobile distribution.

---

## 🎮 Core Gameplay Mechanics

Clear dice on a 5x9 board before it fills up! Built for one-handed portrait play.

1. **Walking & Running:**
   * **On Top of Dice:** Run quickly from die to die. Walk off the edge of any die to descend to the floor.
   * **On the Floor:** Push and slide dice by running against them! Sliding does not change the top face value.

2. **Matching & Clearing:**
   * Align a connected group of dice showing the **same value** on top.
   * The number of connected dice in the group must be **at least** equal to the value itself (e.g., at least **2** dice showing **2**, at least **3** dice showing **3**, etc. up to at least **6** dice showing **6**).
   * Once matched, the dice group begins to glow and slowly **sink** into the floor.

3. **Chain Combo Reactions:**
   * While a group of dice is sinking, roll another die of the same value next to them to join the chain!
   * Chaining **resets the sinking timer** for the entire group, extends its life, and awards huge progressive combo score multipliers.

4. **The Power of 1s (The Joker):**
   * A die with **1** on top cannot match on its own (since you can't have "at least" 1 die form a group without it triggering constantly).
   * However, if you roll a **1** adjacent to *any sinking group*, it is instantly absorbed, starts sinking, and extends the chain! Use 1s to clear isolated dice and bridge multiple groups!

5. **Spawning & Tension (Trial Mode):**
   * New dice periodically emerge from the floor.
   * If the grid fills up completely (all 49 spaces occupied) and you cannot make any more matches, the board gets saturated, and it is **Game Over**! Keep clearing dice to survive!

---

## 🛠️ Technology Stack

* **Graphics:** [Three.js (r128)](https://threejs.org/) via CDN — handles the 3D meshes, isometric camera, realistic materials, soft shadows, and dynamic fog.
* **Audio:** **HTML5 Web Audio API** — synthesizes retro chimes, thuds, combo bells, and background music loops entirely programmatically. No audio files or assets to load!
* **Texturing:** **HTML5 Canvas 2D Context** — draws high-definition rounded-corner die faces with volumetric glowing pips on the fly and converts them to 3D CanvasTextures.
* **Storage:** **LocalStorage** — saves and persists your personal high score locally across sessions.
* **Responsive Layout:** Responsive CSS grid and flex overlays designed with CSS variables, notched/safe-area viewport padding (`viewport-fit=cover`), and portrait/landscape adaptation.

---

## 🚀 How to Run Locally

Because the game uses WebGL and Web Audio, modern browsers require files to be served from a web server (to prevent CORS restrictions on local resources/modules).

### Option A: Python (Easiest, zero-install)
Run this command in this directory:
```bash
python3 -m http.server 8000
```
Then open your browser and navigate to: `http://localhost:8000`

### Option B: Node.js / Static Server
If you prefer Node.js, install and run a global static server:
```bash
npm install -g http-server
http-server -p 8000
```
Then navigate to: `http://localhost:8000`

---

## 📱 Mobile Packaging & Distribution (iOS & Android)

This project was built from the ground up to be easily distributed on iOS and Android App Stores using **Capacitor** (by Ionic) or run as an offline-first **PWA** (Progressive Web App).

### Method 1: Wrapping with Capacitor (Recommended for App Stores)

[Capacitor](https://capacitorjs.com/) is a modern tool that turns any web application into a native iOS and Android app with full native bridge access.

#### 1. Initialize a Node Project & Install Capacitor
In the project root directory, run:
```bash
npm init -y
npm install @capacitor/core @capacitor/cli
```

#### 2. Initialize Capacitor Config
```bash
npx cap init "Devil Dice 3D" "com.yourname.devildice3d" --web-dir=.
```
*Note: We set `--web-dir=.` because our index.html and static files are in the root folder.*

#### 3. Add Android and iOS Platforms
```bash
npm install @capacitor/android @capacitor/ios
npx cap add android
npx cap add ios
```

#### 4. Build and Sync
Whenever you make changes to `game.js`, `index.html`, or `style.css`, run:
```bash
npx cap sync
```

#### 5. Open in Android Studio or Xcode to compile
* **For Android:**
  ```bash
  npx cap open android
  ```
  This opens the project in Android Studio. From there, you can connect your phone or emulator and click **Run**, or build a signed release APK/AAB for the Google Play Store.
  
* **For iOS (Mac required):**
  ```bash
  npx cap open ios
  ```
  This opens Xcode. Select your connected iPhone, choose your developer team, and click **Run**, or archive it to submit to the Apple App Store.

---

### Method 2: Deploying as a Progressive Web App (PWA)

If you want users to be able to install the game on their phone directly from a mobile web browser (Safari/Chrome) without going through app stores, you can configure it as a PWA.

To make this a PWA, add a `manifest.json` and a simple Service Worker file:

#### 1. Create a `manifest.json` file:
```json
{
  "name": "Devil Dice 3D",
  "short_name": "DevilDice",
  "start_url": "./index.html",
  "display": "standalone",
  "background_color": "#0c0810",
  "theme_color": "#ff3366",
  "orientation": "any",
  "icons": [
    {
      "src": "icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

#### 2. Link it in `index.html`:
```html
<link rel="manifest" href="manifest.json">
```

#### 3. Register a basic Service Worker in `game.js`:
Add this at the very top of `game.js` to enable offline play support:
```javascript
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker registered!'))
            .catch(err => console.error('Service Worker failed: ', err));
    });
}
```

---

## 🕹️ Control Customizations (Settings Menu)

Open the **Controls & Settings** panel from the main menu to choose your preferred input method:

1. **Diagonal D-Pad (Default):**
   * Displays a circular D-pad mapped to isometric directions (↖ ↗ ↙ ↘).
   * NW, NE, SW, SE directions align directly with the screen's diagonal perspective, providing the most precise tactile feedback.

2. **Swipe Gestures:**
   * Swipe anywhere on the screen in the diagonal direction you want to move.
   * Hides the virtual D-Pad to reveal the beautiful grid floor.

3. **Desktop Keyboard:**
   * Arrow keys or WASD map natively to the diagonal directions.
   * Spacebar or Enter is used for Climb/Descend commands.
