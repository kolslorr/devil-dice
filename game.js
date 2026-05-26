/**
 * Devil Dice 3D - Core Game Engine
 * A responsive, high-fidelity classic puzzle game built with Three.js.
 */

// --- SERVICE WORKER REGISTRATION (PWA Support) ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker registered!'))
            .catch(err => console.error('Service Worker registration failed: ', err));
    });
}

// --- CONFIGURATION ---
const GRID_COLS = 7;
const GRID_ROWS = 7;
const GRID_SPACING = 1.3; // Space between dice centers in 3D world units
const DIE_SCALE = 1.0;    // Size of the die mesh
const PLAYER_SCALE = 0.55; // Player height multiplier
const FALL_SPEED = 9.8;   // Gravity fall speed
const ROLL_DURATION = 220; // Milliseconds for a die rolling animation
const MOVE_DURATION = 150; // Milliseconds for player walking animation
const CLIMB_DURATION = 250; // Milliseconds for climbing animation
const SINK_DURATION = 4000; // Milliseconds a matched die takes to sink completely

// Spawn timing based on difficulty (milliseconds)
const DIFFICULTY_SETTINGS = {
    easy: { spawnInterval: 9000, initialDice: 15 },
    medium: { spawnInterval: 6500, initialDice: 22 },
    hard: { spawnInterval: 4500, initialDice: 28 }
};

// Standard Right-Handed Die faces definition
// Opposite faces sum to 7. Initial configuration when top=1:
// Top=1, Bottom=6, Front=2 (South), Back=5 (North), Left=4 (West), Right=3 (East)
const INITIAL_DIE_FACES = {
    top: 1,
    bottom: 6,
    front: 2, // South (+Z)
    back: 5,  // North (-Z)
    left: 4,  // West (-X)
    right: 3  // East (+X)
};

// Direction vector mapping (diagonal alignment for isometric board)
const DIRECTIONS = {
    ul: { dx: 0, dy: -1 }, // North / Up-Left (towards -Z in world space)
    ur: { dx: 1, dy: 0 },  // East / Up-Right (towards +X in world space)
    dl: { dx: -1, dy: 0 }, // West / Down-Left (towards -X in world space)
    dr: { dx: 0, dy: 1 }   // South / Down-Right (towards +Z in world space)
};

// Color scheme palettes
const PALETTE = {
    boardFloor: 0x140e21,
    boardGrid: 0x4a3266,
    playerBody: 0xff3366,
    playerHorns: 0xffcc00,
    playerEyes: 0xffff00,
    playerCape: 0x220e35,
    normalDie: { bg: '#231c30', pips: '#00ff66', border: '#403454' },
    sinkingDie: { bg: '#990033', pips: '#ffffff', border: '#ff3366' },
    risingDie: { bg: '#0e2b45', pips: '#33ccff', border: '#1f5380' },
    sinkingOne: { bg: '#ffffff', pips: '#ff3366', border: '#ff88aa' }
};

// --- GLOBAL STATE ---
let scene, camera, renderer;
let diceGroup, boardGroup;
let grid = Array(GRID_COLS).fill(null).map(() => Array(GRID_ROWS).fill(null));
let player = null;
let score = 0;
let comboCount = 0;
let highScore = localStorage.getItem('devildice_highscore') ? parseInt(localStorage.getItem('devildice_highscore')) : 0;
let gameState = 'menu'; // 'menu', 'playing', 'paused', 'gameover'
let selectedDifficulty = 'medium';
let controlMode = 'diagonal'; // 'diagonal', 'swipe', 'joystick'
let soundEnabled = true;
let musicEnabled = false;
let spawnTimerId = null;
let activeSinkingGroups = []; // List of sinking dice group arrays
let totalCells = GRID_COLS * GRID_ROWS;

// Audio context and nodes
let audioCtx = null;
let bgmOsc = null;
let bgmGain = null;
let bgmIntervalId = null;

// Textures cache
const textureCache = {};
const materialsCache = {};

// --- WEB AUDIO SYNTHESIZER ---
const AudioEngine = {
    init() {
        if (audioCtx) return;
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.error('Web Audio API not supported', e);
        }
    },

    playTone(freq, type, duration, gainVal, slideToFreq = null) {
        if (!soundEnabled || !audioCtx) return;
        this.init();
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        
        if (slideToFreq !== null) {
            osc.frequency.exponentialRampToValueAtTime(slideToFreq, audioCtx.currentTime + duration);
        }

        gain.gain.setValueAtTime(gainVal, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    },

    playMove() {
        this.playTone(150, 'triangle', 0.08, 0.2, 50);
    },

    playRoll() {
        this.playTone(180, 'sawtooth', 0.15, 0.15, 80);
    },

    playSlide() {
        this.playTone(120, 'triangle', 0.2, 0.18, 70);
    },

    playClimb() {
        this.playTone(300, 'sine', 0.12, 0.25, 450);
    },

    playMatch() {
        // Play a nice retro arpeggio chord
        const notes = [261.63, 329.63, 392.00, 523.25]; // C major
        notes.forEach((f, i) => {
            setTimeout(() => {
                this.playTone(f, 'sine', 0.3, 0.15, f * 1.5);
            }, i * 60);
        });
    },

    playCombo(count) {
        // High pitch ding rising with combo count
        const pitchMultiplier = 1 + (count * 0.1);
        this.playTone(880 * pitchMultiplier, 'sine', 0.4, 0.2, 1200 * pitchMultiplier);
    },

    playGameOver() {
        const notes = [392.00, 349.23, 311.13, 246.94]; // Descending sad chord
        notes.forEach((f, i) => {
            setTimeout(() => {
                this.playTone(f, 'triangle', 0.5, 0.2, f * 0.5);
            }, i * 150);
        });
    },

    startBGM() {
        if (!musicEnabled) return;
        this.init();
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        bgmGain = audioCtx.createGain();
        bgmGain.gain.setValueAtTime(0.04, audioCtx.currentTime);
        bgmGain.connect(audioCtx.destination);

        let step = 0;
        const melody = [130.81, 164.81, 196.00, 164.81, 146.83, 174.61, 220.00, 174.61]; // Retro bass line loop

        bgmIntervalId = setInterval(() => {
            if (!musicEnabled || !audioCtx) return;
            
            const osc = audioCtx.createOscillator();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(melody[step % melody.length], audioCtx.currentTime);
            osc.connect(bgmGain);
            
            osc.start();
            osc.stop(audioCtx.currentTime + 0.35);

            // Trigger a soft high hat occasionally
            if (step % 2 === 0) {
                this.playNoise(0.05, 0.015);
            }

            step++;
        }, 400);
    },

    stopBGM() {
        if (bgmIntervalId) {
            clearInterval(bgmIntervalId);
            bgmIntervalId = null;
        }
        if (bgmGain) {
            bgmGain.disconnect();
            bgmGain = null;
        }
    },

    playNoise(duration, gainVal) {
        if (!soundEnabled || !audioCtx) return;
        const bufferSize = audioCtx.sampleRate * duration;
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noiseNode = audioCtx.createBufferSource();
        noiseNode.buffer = buffer;

        const noiseFilter = audioCtx.createBiquadFilter();
        noiseFilter.type = 'highpass';
        noiseFilter.frequency.value = 5000;

        const noiseGain = audioCtx.createGain();
        noiseGain.gain.setValueAtTime(gainVal, audioCtx.currentTime);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

        noiseNode.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(audioCtx.destination);

        noiseNode.start();
    }
};

// --- PROCEDURAL TEXTURE GENERATION ---
// Renders a high-fidelity die face onto an HTML5 Canvas, then converts to Three.js texture
function getDiceTexture(value, state = 'normal') {
    const cacheKey = `${value}_${state}`;
    if (textureCache[cacheKey]) {
        return textureCache[cacheKey];
    }

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    // Get styling configuration based on state
    let colors = PALETTE.normalDie;
    if (state === 'sinking') colors = PALETTE.sinkingDie;
    if (state === 'rising') colors = PALETTE.risingDie;
    if (state === 'sinking_one') colors = PALETTE.sinkingOne;

    // Draw background
    ctx.fillStyle = colors.border;
    ctx.fillRect(0, 0, 128, 128);

    // Draw inner face with rounded corners
    ctx.fillStyle = colors.bg;
    const r = 12; // corner radius
    const m = 6;  // margin
    ctx.beginPath();
    ctx.moveTo(m + r, m);
    ctx.lineTo(128 - m - r, m);
    ctx.quadraticCurveTo(128 - m, m, 128 - m, m + r);
    ctx.lineTo(128 - m, 128 - m - r);
    ctx.quadraticCurveTo(128 - m, 128 - m, 128 - m - r, 128 - m);
    ctx.lineTo(m + r, 128 - m);
    ctx.quadraticCurveTo(m, 128 - m, m, 128 - m - r);
    ctx.lineTo(m, m + r);
    ctx.quadraticCurveTo(m, m, m + r, m);
    ctx.closePath();
    ctx.fill();

    // Draw subtle inner glow/gradient shadow
    const grad = ctx.createRadialGradient(64, 64, 10, 64, 64, 60);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.05)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Draw face value pips (dots)
    ctx.fillStyle = colors.pips;
    ctx.shadowBlur = 8;
    ctx.shadowColor = colors.pips;

    const pipRadius = 10;
    const padding = 32;

    const positions = {
        center: [64, 64],
        tl: [padding, padding],
        tr: [128 - padding, padding],
        bl: [padding, 128 - padding],
        br: [128 - padding, 128 - padding],
        ml: [padding, 64],
        mr: [128 - padding, 64]
    };

    const drawPip = (pos) => {
        ctx.beginPath();
        ctx.arc(pos[0], pos[1], pipRadius, 0, Math.PI * 2);
        ctx.fill();
    };

    switch (value) {
        case 1:
            drawPip(positions.center);
            break;
        case 2:
            drawPip(positions.tl);
            drawPip(positions.br);
            break;
        case 3:
            drawPip(positions.tl);
            drawPip(positions.center);
            drawPip(positions.br);
            break;
        case 4:
            drawPip(positions.tl);
            drawPip(positions.tr);
            drawPip(positions.bl);
            drawPip(positions.br);
            break;
        case 5:
            drawPip(positions.tl);
            drawPip(positions.tr);
            drawPip(positions.center);
            drawPip(positions.bl);
            drawPip(positions.br);
            break;
        case 6:
            drawPip(positions.tl);
            drawPip(positions.tr);
            drawPip(positions.ml);
            drawPip(positions.mr);
            drawPip(positions.bl);
            drawPip(positions.br);
            break;
    }

    const texture = new THREE.CanvasTexture(canvas);
    textureCache[cacheKey] = texture;
    return texture;
}

// Get materials array (6 faces) for a die value
function getDiceMaterials(diceFacesObj, state = 'normal') {
    // We construct a cache key based on the exact face values and state
    const key = `${diceFacesObj.right}_${diceFacesObj.left}_${diceFacesObj.top}_${diceFacesObj.bottom}_${diceFacesObj.back}_${diceFacesObj.front}_${state}`;
    if (materialsCache[key]) {
        return materialsCache[key];
    }

    const matRight = new THREE.MeshLambertMaterial({ map: getDiceTexture(diceFacesObj.right, state) });
    const matLeft = new THREE.MeshLambertMaterial({ map: getDiceTexture(diceFacesObj.left, state) });
    const matTop = new THREE.MeshLambertMaterial({ map: getDiceTexture(diceFacesObj.top, state) });
    const matBottom = new THREE.MeshLambertMaterial({ map: getDiceTexture(diceFacesObj.bottom, state) });
    const matBack = new THREE.MeshLambertMaterial({ map: getDiceTexture(diceFacesObj.back, state) });
    const matFront = new THREE.MeshLambertMaterial({ map: getDiceTexture(diceFacesObj.front, state) });

    // Enable transparency for sinking fade out
    if (state === 'sinking' || state === 'sinking_one') {
        [matRight, matLeft, matTop, matBottom, matBack, matFront].forEach(m => {
            m.transparent = true;
            m.opacity = 1.0;
        });
    }

    const materials = [matRight, matLeft, matTop, matBottom, matBack, matFront];
    materialsCache[key] = materials;
    return materials;
}


// --- 3D DIE CLASS ---
class Die {
    constructor(gridX, gridY, topValue = null) {
        this.gridX = gridX;
        this.gridY = gridY;
        this.state = 'rising'; // 'rising', 'normal', 'sinking'
        this.height = -1.0;    // start below ground
        this.sinkingGroup = null;
        this.sinkingTimer = 0;
        
        // Setup initial physical faces orientation
        this.faces = Object.assign({}, INITIAL_DIE_FACES);

        // If a specific top value is requested, we rotate the die to show it
        if (topValue !== null && topValue !== 1) {
            this.forceTopValue(topValue);
        } else if (topValue === null) {
            this.forceTopValue(Math.floor(Math.random() * 6) + 1);
        }

        // Create 3D Box Geometry and mesh
        const geometry = new THREE.BoxGeometry(DIE_SCALE, DIE_SCALE, DIE_SCALE);
        this.materials = getDiceMaterials(this.faces, 'rising');
        this.mesh = new THREE.Mesh(geometry, this.materials);
        
        // Enable shadows
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;

        this.updateMeshPosition();
        diceGroup.add(this.mesh);

        // Animate rising entry
        this.animateRise();
    }

    // Force orientation to show a specific top value (maintaining valid standard opposite face sums)
    forceTopValue(targetTop) {
        if (this.faces.top === targetTop) return;

        // Opposite to targetTop is 7 - targetTop
        const targetBottom = 7 - targetTop;

        // Find standard orientation for targetTop
        const standardMapping = {
            1: { top: 1, bottom: 6, front: 2, back: 5, left: 4, right: 3 },
            2: { top: 2, bottom: 5, front: 6, back: 1, left: 4, right: 3 },
            3: { top: 3, bottom: 4, front: 2, back: 5, left: 1, right: 6 },
            4: { top: 4, bottom: 3, front: 2, back: 5, left: 6, right: 1 },
            5: { top: 5, bottom: 2, front: 1, back: 6, left: 4, right: 3 },
            6: { top: 6, bottom: 1, front: 5, back: 2, left: 4, right: 3 }
        };

        this.faces = Object.assign({}, standardMapping[targetTop]);

        // Randomly rotate around the vertical axis to add visual variance
        const rotations = Math.floor(Math.random() * 4);
        for (let i = 0; i < rotations; i++) {
            this.rotateFacesClockwiseY();
        }
    }

    // Rotate faces clockwise looking down from +Y axis (helper for visual randomisation)
    rotateFacesClockwiseY() {
        const temp = this.faces.front;
        this.faces.front = this.faces.right;
        this.faces.right = this.faces.back;
        this.faces.back = this.faces.left;
        this.faces.left = temp;
    }

    updateMeshPosition() {
        // Map grid (0 to 6) to 3D coordinate system centered at (0,0,0)
        const wx = (this.gridX - (GRID_COLS - 1) / 2) * GRID_SPACING;
        const wz = (this.gridY - (GRID_ROWS - 1) / 2) * GRID_SPACING;
        
        // Y position accounts for bottom-alignment of standard 1.0 unit box resting on ground (ground is Y=0)
        // resting height is Y = DIE_SCALE / 2 (0.5). For rising/sinking, height shifts it.
        const wy = (this.height - 0.5) + DIE_SCALE / 2;

        this.mesh.position.set(wx, wy, wz);
    }

    animateRise() {
        const startTime = Date.now();
        const duration = 1500; // time to rise from -1 to 0

        const riseTick = () => {
            if (gameState === 'paused' || this.state !== 'rising') {
                if (this.state === 'rising') requestAnimationFrame(riseTick);
                return;
            }

            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1.0);

            // Ease out cubic
            const ease = 1 - Math.pow(1 - progress, 3);
            this.height = -1.0 + ease * 1.0; // from -1.0 to 0.0 resting (which is bottom at floor level)
            this.updateMeshPosition();

            if (progress < 1.0) {
                requestAnimationFrame(riseTick);
            } else {
                this.state = 'normal';
                this.height = 0.0; // fully up (resting at floor)
                this.mesh.material = getDiceMaterials(this.faces, 'normal');
                this.updateMeshPosition();
                
                // Immediately check for matches when a new die reaches the surface
                checkAllMatches();
            }
        };

        requestAnimationFrame(riseTick);
    }

    // Mathematical rolling model and mesh translation animation
    roll(direction, onCompleteCallback) {
        if (this.state !== 'normal') return;
        this.state = 'rolling';

        const startX = this.gridX;
        const startY = this.gridY;
        const dir = DIRECTIONS[direction];
        
        const endX = startX + dir.dx;
        const endY = startY + dir.dy;

        // Clear original grid slot
        grid[startX][startY] = null;
        // Allocate target grid slot
        grid[endX][endY] = this;

        this.gridX = endX;
        this.gridY = endY;

        // Compute updated face orientation values
        const oldFaces = Object.assign({}, this.faces);
        let rotationAxis = new THREE.Vector3();
        let rotationSign = 1;

        if (direction === 'ur') { // Roll East (+X)
            this.faces.top = oldFaces.left;
            this.faces.right = oldFaces.top;
            this.faces.bottom = oldFaces.right;
            this.faces.left = oldFaces.bottom;
            rotationAxis.set(0, 0, -1); // rotate clockwise around Z
        } else if (direction === 'dl') { // Roll West (-X)
            this.faces.top = oldFaces.right;
            this.faces.left = oldFaces.top;
            this.faces.bottom = oldFaces.left;
            this.faces.right = oldFaces.bottom;
            rotationAxis.set(0, 0, 1);  // rotate counter-clockwise around Z
        } else if (direction === 'dr') { // Roll South (+Z)
            this.faces.top = oldFaces.back;  // North rolls to top
            this.faces.front = oldFaces.top; // top rolls to South
            this.faces.bottom = oldFaces.front;
            this.faces.back = oldFaces.bottom;
            rotationAxis.set(1, 0, 0); // rotate around X
        } else if (direction === 'ul') { // Roll North (-Z)
            this.faces.top = oldFaces.front; // South rolls to top
            this.faces.back = oldFaces.top;  // top rolls to North
            this.faces.bottom = oldFaces.back;
            this.faces.front = oldFaces.bottom;
            rotationAxis.set(-1, 0, 0); // rotate around X
        }

        AudioEngine.playRoll();

        // Animate rolling movement
        const startTime = Date.now();
        const startWX = (startX - (GRID_COLS - 1) / 2) * GRID_SPACING;
        const startWZ = (startY - (GRID_ROWS - 1) / 2) * GRID_SPACING;
        const endWX = (endX - (GRID_COLS - 1) / 2) * GRID_SPACING;
        const endWZ = (endY - (GRID_ROWS - 1) / 2) * GRID_SPACING;

        const rollTick = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / ROLL_DURATION, 1.0);

            // Linear interpolation of X/Z coordinates
            const wx = startWX + progress * (endWX - startWX);
            const wz = startWZ + progress * (endWZ - startWZ);
            
            // Add a curved "hop" lift along Y to simulate pivoting on edge
            // max hop is 0.18 units high at midpoint
            const wy = Math.sin(progress * Math.PI) * 0.18;

            this.mesh.position.set(wx, wy, wz);

            // Rotate mesh visually during animation
            // Exactly 90 degrees (PI/2) at completion
            const angle = progress * (Math.PI / 2);
            this.mesh.setRotationFromAxisAngle(rotationAxis, angle);

            if (progress < 1.0) {
                requestAnimationFrame(rollTick);
            } else {
                // Reset physical mesh rotation to (0,0,0) and swap materials to new face values
                this.mesh.rotation.set(0, 0, 0);
                this.mesh.material = getDiceMaterials(this.faces, 'normal');
                this.state = 'normal';
                this.height = 0.0;
                this.updateMeshPosition();

                if (onCompleteCallback) onCompleteCallback();
            }
        };

        requestAnimationFrame(rollTick);
    }

    slide(direction, onCompleteCallback) {
        if (this.state !== 'normal') return;
        this.state = 'rolling';

        const startX = this.gridX;
        const startY = this.gridY;
        const dir = DIRECTIONS[direction];
        
        const endX = startX + dir.dx;
        const endY = startY + dir.dy;

        // Clear original grid slot
        grid[startX][startY] = null;
        // Allocate target grid slot
        grid[endX][endY] = this;

        this.gridX = endX;
        this.gridY = endY;

        AudioEngine.playSlide();

        // Animate sliding movement
        const startTime = Date.now();
        const startWX = (startX - (GRID_COLS - 1) / 2) * GRID_SPACING;
        const startWZ = (startY - (GRID_ROWS - 1) / 2) * GRID_SPACING;
        const endWX = (endX - (GRID_COLS - 1) / 2) * GRID_SPACING;
        const endWZ = (endY - (GRID_ROWS - 1) / 2) * GRID_SPACING;

        const slideTick = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / ROLL_DURATION, 1.0);

            // Linear interpolation of X/Z coordinates
            const wx = startWX + progress * (endWX - startWX);
            const wz = startWZ + progress * (endWZ - startWZ);
            
            // Sliding is flat, so Y is 0.0
            const wy = 0.0;

            this.mesh.position.set(wx, wy, wz);

            if (progress < 1.0) {
                requestAnimationFrame(slideTick);
            } else {
                this.state = 'normal';
                this.height = 0.0;
                this.updateMeshPosition();

                if (onCompleteCallback) onCompleteCallback();
            }
        };

        requestAnimationFrame(slideTick);
    }

    startSinking(groupId) {
        if (this.state === 'sinking') return;
        this.state = 'sinking';
        this.sinkingGroup = groupId;
        this.sinkingTimer = Date.now();
        
        // Update texture to glowing magenta matching theme
        const isOne = (this.faces.top === 1);
        this.mesh.material = getDiceMaterials(this.faces, isOne ? 'sinking_one' : 'sinking');
    }

    // Process sinking frame update, returns true if completely submerged
    updateSinking() {
        if (this.state !== 'sinking') return false;

        const elapsed = Date.now() - this.sinkingTimer;
        const progress = Math.min(elapsed / SINK_DURATION, 1.0);

        // Slide down and fade out transparent material opacity
        this.height = -progress * 1.0;
        this.updateMeshPosition();

        this.mesh.material.forEach(m => {
            m.opacity = 1.0 - progress;
        });

        if (progress >= 1.0) {
            // Sunk completely, remove from scene and grid
            diceGroup.remove(this.mesh);
            this.mesh.geometry.dispose();
            if (grid[this.gridX][this.gridY] === this) {
                grid[this.gridX][this.gridY] = null;
            }
            return true;
        }
        return false;
    }
}


// --- PROCEDURAL 3D PLAYER CLASS ---
class Player {
    constructor(gridX, gridY) {
        this.gridX = gridX;
        this.gridY = gridY;
        this.height = 0.0; // 0.0 = on floor, 1.0 = on top of dice
        this.state = 'idle'; // 'idle', 'walking', 'climbing', 'descending'
        this.facingDir = new THREE.Vector2(0, 1); // looking South initially

        // Build procedural character group
        this.group = new THREE.Group();
        
        // Body (rounded box/capsule substitute)
        const bodyGeom = new THREE.CylinderGeometry(0.25, 0.22, 0.5, 8);
        const bodyMat = new THREE.MeshLambertMaterial({ color: PALETTE.playerBody });
        this.bodyMesh = new THREE.Mesh(bodyGeom, bodyMat);
        this.bodyMesh.position.y = 0.25;
        this.bodyMesh.castShadow = true;
        this.group.add(this.bodyMesh);

        // Head
        const headGeom = new THREE.SphereGeometry(0.2, 12, 12);
        const headMat = new THREE.MeshLambertMaterial({ color: PALETTE.playerBody });
        this.headMesh = new THREE.Mesh(headGeom, headMat);
        this.headMesh.position.y = 0.6;
        this.headMesh.castShadow = true;
        this.group.add(this.headMesh);

        // Left Horn
        const hornGeom = new THREE.ConeGeometry(0.06, 0.18, 5);
        const hornMat = new THREE.MeshLambertMaterial({ color: PALETTE.playerHorns });
        this.leftHorn = new THREE.Mesh(hornGeom, hornMat);
        this.leftHorn.position.set(-0.08, 0.74, 0.03);
        this.leftHorn.rotation.set(0.1, 0, 0.3); // flare outwards slightly
        this.group.add(this.leftHorn);

        // Right Horn
        this.rightHorn = this.leftHorn.clone();
        this.rightHorn.position.x = 0.08;
        this.rightHorn.rotation.z = -0.3;
        this.group.add(this.rightHorn);

        // Glowing Eyes
        const eyeGeom = new THREE.SphereGeometry(0.03, 6, 6);
        const eyeMat = new THREE.MeshBasicMaterial({ color: PALETTE.playerEyes });
        this.leftEye = new THREE.Mesh(eyeGeom, eyeMat);
        this.leftEye.position.set(-0.06, 0.62, 0.16);
        this.group.add(this.leftEye);

        this.rightEye = this.leftEye.clone();
        this.rightEye.position.x = 0.06;
        this.group.add(this.rightEye);

        // Cape
        const capeGeom = new THREE.ConeGeometry(0.22, 0.45, 4, 1, true, 0, Math.PI); // half cone
        const capeMat = new THREE.MeshLambertMaterial({ color: PALETTE.playerCape, side: THREE.DoubleSide });
        this.capeMesh = new THREE.Mesh(capeGeom, capeMat);
        this.capeMesh.position.set(0, 0.35, -0.15);
        this.capeMesh.rotation.set(0.1, Math.PI, 0);
        this.group.add(this.capeMesh);

        // Legs (small sphere waddles)
        const legGeom = new THREE.SphereGeometry(0.07, 6, 6);
        const legMat = new THREE.MeshLambertMaterial({ color: 0x1a1525 });
        this.leftLeg = new THREE.Mesh(legGeom, legMat);
        this.leftLeg.position.set(-0.1, 0.02, 0);
        this.group.add(this.leftLeg);

        this.rightLeg = this.leftLeg.clone();
        this.rightLeg.position.x = 0.1;
        this.group.add(this.rightLeg);

        // Set scaling and shadows for the entire group
        this.group.scale.set(PLAYER_SCALE, PLAYER_SCALE, PLAYER_SCALE);
        this.group.traverse(node => {
            if (node.isMesh) {
                node.castShadow = true;
                node.receiveShadow = true;
            }
        });

        scene.add(this.group);
        this.update3DPosition();
    }

    update3DPosition() {
        const wx = (this.gridX - (GRID_COLS - 1) / 2) * GRID_SPACING;
        const wz = (this.gridY - (GRID_ROWS - 1) / 2) * GRID_SPACING;
        
        // Base coordinate rests either on floor (Y=0) or top of die (Y=GRID_SPACING/1.3, which is height of die)
        // Wait, physical height of die is DIE_SCALE = 1.0.
        // So on floor, base Y is 0.0. On top of die, base Y is 1.0.
        let wy = this.height * 1.0;

        // If on top of a sinking die, align Y with its current sink offset
        if (this.height === 1.0) {
            const standingDie = grid[this.gridX][this.gridY];
            if (standingDie && standingDie.state === 'sinking') {
                wy += standingDie.height; // sinking height is negative, from 0.0 to -1.0
            }
        }

        this.group.position.set(wx, wy, wz);

        // Handle visual yaw rotation (look-at angle) based on facing vector
        const angle = Math.atan2(this.facingDir.x, this.facingDir.y);
        this.group.rotation.y = angle;
    }

    // Triggers step movement
    attemptMove(direction) {
        if (this.state !== 'idle') return;

        const dir = DIRECTIONS[direction];
        this.facingDir.set(dir.dx, dir.dy);

        const targetX = this.gridX + dir.dx;
        const targetY = this.gridY + dir.dy;

        // Wall boundary checks
        if (targetX < 0 || targetX >= GRID_COLS || targetY < 0 || targetY >= GRID_ROWS) {
            AudioEngine.playMove(); // play thud
            return;
        }

        const currentDie = grid[this.gridX][this.gridY];
        const targetDie = grid[targetX][targetY];

        // Case A: PLAYER IS ON TOP OF DICE (height = 1.0)
        if (this.height === 1.0) {
            if (targetDie && (targetDie.state === 'normal' || targetDie.state === 'sinking')) {
                // Step onto neighboring die (smoothly transition heights if one is sinking)
                const startH = 1.0 + (currentDie && currentDie.state === 'sinking' ? currentDie.height : 0.0);
                const endH = 1.0 + (targetDie.state === 'sinking' ? targetDie.height : 0.0);
                this.animateWalk(targetX, targetY, startH, endH);
            } else if (!targetDie) {
                // No die in target slot:
                // Walk normally on top of die -> Rolls the die underneath the player!
                if (currentDie && currentDie.state === 'normal') {
                    this.state = 'rolling_on_top';
                    
                    const startPlayerX = this.gridX;
                    const startPlayerY = this.gridY;
                    this.gridX = targetX;
                    this.gridY = targetY;

                    const startTime = Date.now();
                    const startWX = (startPlayerX - (GRID_COLS - 1) / 2) * GRID_SPACING;
                    const startWZ = (startPlayerY - (GRID_ROWS - 1) / 2) * GRID_SPACING;
                    const endWX = (targetX - (GRID_COLS - 1) / 2) * GRID_SPACING;
                    const endWZ = (targetY - (GRID_ROWS - 1) / 2) * GRID_SPACING;

                    currentDie.roll(direction, () => {
                        checkAllMatches();
                        this.state = 'idle';
                    });

                    const rollOnTopTick = () => {
                        const elapsed = Date.now() - startTime;
                        const progress = Math.min(elapsed / ROLL_DURATION, 1.0);

                        const wx = startWX + progress * (endWX - startWX);
                        const wz = startWZ + progress * (endWZ - startWZ);
                        const wy = 1.0 + Math.sin(progress * Math.PI) * 0.18; // 1.0 height + hop height

                        // Waddling/running animation for player
                        this.leftLeg.position.y = Math.max(0, Math.sin(progress * Math.PI * 4) * 0.1);
                        this.rightLeg.position.y = Math.max(0, Math.cos(progress * Math.PI * 4) * 0.1);
                        this.bodyMesh.position.y = 0.25 + Math.abs(Math.sin(progress * Math.PI * 4)) * 0.05;

                        this.group.position.set(wx, wy, wz);

                        if (progress < 1.0) {
                            requestAnimationFrame(rollOnTopTick);
                        } else {
                            this.update3DPosition();
                        }
                    };
                    requestAnimationFrame(rollOnTopTick);
                } else {
                    // Standing on a sinking die and walking into empty space -> Cannot roll it. Play thud.
                    AudioEngine.playMove();
                }
            } else if (targetDie.state === 'rising') {
                // Rising dice block walkway on top until fully surfaced
                AudioEngine.playMove();
            }
        } 
        // Case B: PLAYER IS ON THE FLOOR (height = 0.0)
        else {
            if (!targetDie) {
                // Walk freely on empty floor
                this.animateWalk(targetX, targetY, 0.0, 0.0);
            } else if (targetDie && targetDie.state === 'normal') {
                // Player ran into a die on the floor.
                // Action: Push & Slide it if space beyond is empty!
                const beyondX = targetX + dir.dx;
                const beyondY = targetY + dir.dy;

                const isBeyondEmpty = (beyondX >= 0 && beyondX < GRID_COLS && beyondY >= 0 && beyondY < GRID_ROWS) && (grid[beyondX][beyondY] === null);

                if (isBeyondEmpty) {
                    this.state = 'pushing';
                    
                    // Simultaneously animate player step forward and die sliding forward
                    const startPlayerX = this.gridX;
                    const startPlayerY = this.gridY;
                    this.gridX = targetX;
                    this.gridY = targetY;

                    const startTime = Date.now();
                    const startWX = (startPlayerX - (GRID_COLS - 1) / 2) * GRID_SPACING;
                    const startWZ = (startPlayerY - (GRID_ROWS - 1) / 2) * GRID_SPACING;
                    const endWX = (targetX - (GRID_COLS - 1) / 2) * GRID_SPACING;
                    const endWZ = (targetY - (GRID_ROWS - 1) / 2) * GRID_SPACING;

                    // Start the sliding of the die
                    targetDie.slide(direction, () => {
                        // After slide completes, evaluate matches
                        checkAllMatches();
                        this.state = 'idle';
                    });

                    // Animate player walking forward behind the pushed die
                    const pushWalkTick = () => {
                        const elapsed = Date.now() - startTime;
                        const progress = Math.min(elapsed / ROLL_DURATION, 1.0);

                        const wx = startWX + progress * (endWX - startWX);
                        const wz = startWZ + progress * (endWZ - startWZ);
                        
                        // Waddling animation for legs
                        this.leftLeg.position.y = Math.max(0, Math.sin(progress * Math.PI * 4) * 0.1);
                        this.rightLeg.position.y = Math.max(0, Math.cos(progress * Math.PI * 4) * 0.1);
                        this.bodyMesh.position.y = 0.25 + Math.abs(Math.sin(progress * Math.PI * 4)) * 0.05;

                        this.group.position.set(wx, 0.0, wz);

                        if (progress < 1.0) {
                            requestAnimationFrame(pushWalkTick);
                        } else {
                            // Align exactly to final position
                            this.update3DPosition();
                        }
                    };
                    requestAnimationFrame(pushWalkTick);

                } else {
                    // Cannot push because die is blocked. Play thud.
                    AudioEngine.playMove();
                }
            } else if (targetDie && (targetDie.state === 'sinking' || targetDie.state === 'rising')) {
                // Sinking or rising dice act as solid block walls from the floor.
                AudioEngine.playMove();
            }
        }
    }

    climbOnto(targetX, targetY) {
        this.state = 'climbing';
        AudioEngine.playClimb();

        const startTime = Date.now();
        const startWX = (this.gridX - (GRID_COLS - 1) / 2) * GRID_SPACING;
        const startWZ = (this.gridY - (GRID_ROWS - 1) / 2) * GRID_SPACING;
        const endWX = (targetX - (GRID_COLS - 1) / 2) * GRID_SPACING;
        const endWZ = (targetY - (GRID_ROWS - 1) / 2) * GRID_SPACING;

        this.gridX = targetX;
        this.gridY = targetY;

        const climbTick = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / CLIMB_DURATION, 1.0);

            // Smooth S-Curve for vertical and horizontal climb
            const ease = 3 * progress * progress - 2 * progress * progress * progress;

            const wx = startWX + ease * (endWX - startWX);
            const wz = startWZ + ease * (endWZ - startWZ);
            const wy = ease * 1.0; // from 0.0 (floor) to 1.0 (top)

            this.group.position.set(wx, wy, wz);

            // Visual body heave during climb
            this.bodyMesh.position.y = 0.25 + Math.sin(progress * Math.PI) * 0.15;
            this.leftLeg.position.z = Math.sin(progress * Math.PI * 2) * 0.12;
            this.rightLeg.position.z = -Math.sin(progress * Math.PI * 2) * 0.12;

            if (progress < 1.0) {
                requestAnimationFrame(climbTick);
            } else {
                this.height = 1.0;
                this.state = 'idle';
                this.update3DPosition();
                
                // When landing on top of a die, reset waddling parts
                this.bodyMesh.position.y = 0.25;
                this.leftLeg.position.set(-0.1, 0.02, 0);
                this.rightLeg.position.set(0.1, 0.02, 0);
            }
        };

        requestAnimationFrame(climbTick);
    }

    descendManual() {
        if (this.state !== 'idle' || this.height === 0.0) return;

        // Find empty neighbor in facing direction to descend onto
        const targetX = this.gridX + Math.round(this.facingDir.x);
        const targetY = this.gridY + Math.round(this.facingDir.y);

        // Boundary safety check
        if (targetX < 0 || targetX >= GRID_COLS || targetY < 0 || targetY >= GRID_ROWS) return;

        const targetDie = grid[targetX][targetY];
        if (!targetDie) {
            // Drop down to floor
            this.animateWalk(targetX, targetY, 1.0, 0.0, 'descending');
        }
    }

    // Walks player from node to node with waddling animation
    animateWalk(targetX, targetY, startHeight, endHeight, forceState = 'walking') {
        this.state = forceState;
        AudioEngine.playMove();

        const startWX = (this.gridX - (GRID_COLS - 1) / 2) * GRID_SPACING;
        const startWZ = (this.gridY - (GRID_ROWS - 1) / 2) * GRID_SPACING;
        const endWX = (targetX - (GRID_COLS - 1) / 2) * GRID_SPACING;
        const endWZ = (targetY - (GRID_ROWS - 1) / 2) * GRID_SPACING;

        this.gridX = targetX;
        this.gridY = targetY;

        const startTime = Date.now();
        const duration = (forceState === 'descending') ? CLIMB_DURATION : MOVE_DURATION;

        const walkTick = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1.0);

            // Position interpolate
            const wx = startWX + progress * (endWX - startWX);
            const wz = startWZ + progress * (endWZ - startWZ);
            const wy = (startHeight + progress * (endHeight - startHeight)) * 1.0;

            this.group.position.set(wx, wy, wz);

            // Walking bob and waddle
            if (forceState !== 'descending') {
                this.leftLeg.position.y = Math.max(0, Math.sin(progress * Math.PI * 4) * 0.1);
                this.rightLeg.position.y = Math.max(0, Math.cos(progress * Math.PI * 4) * 0.1);
                this.bodyMesh.position.y = 0.25 + Math.abs(Math.sin(progress * Math.PI * 4)) * 0.05;
            } else {
                // Descending flip/heave
                this.bodyMesh.position.y = 0.25 + Math.sin(progress * Math.PI) * 0.12;
            }

            if (progress < 1.0) {
                requestAnimationFrame(walkTick);
            } else {
                this.height = endHeight;
                this.state = 'idle';
                this.update3DPosition();

                // Reset limbs
                this.bodyMesh.position.y = 0.25;
                this.leftLeg.position.set(-0.1, 0.02, 0);
                this.rightLeg.position.set(0.1, 0.02, 0);
                
                // If fell on floor, check if player has stood on a sinking die that vanished, etc.
                if (this.height === 0.0) {
                    // Stood on empty floor
                } else {
                    // Stood on top of die
                }
            }
        };

        requestAnimationFrame(walkTick);
    }
}


// --- SCENE CREATION & INITIALIZATION ---
function initEngine() {
    const container = document.getElementById('game-container');
    container.innerHTML = ''; // clear

    // 1. Create Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(PALETTE.boardFloor);
    scene.fog = new THREE.FogExp2(PALETTE.boardFloor, 0.04);

    // 2. Groups
    boardGroup = new THREE.Group();
    diceGroup = new THREE.Group();
    scene.add(boardGroup);
    scene.add(diceGroup);

    // 3. Renderer with premium shadows
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // performance safety
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // 4. Perfect Isometric Perspective Camera
    camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 1, 100);
    // Position camera diagonally back-right at height, looking at board center (0,0,0)
    camera.position.set(12.5, 11.0, 12.5);
    camera.lookAt(0, -0.2, 0);

    // 5. Lights Setup
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
    scene.add(ambientLight);

    // Directional light for beautiful shadows
    const dirLight = new THREE.DirectionalLight(0xffeedd, 0.85);
    dirLight.position.set(8, 14, 5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 25;
    const d = 6;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    scene.add(dirLight);

    // Back light to bounce purple glow
    const pointLight = new THREE.PointLight(0xff3366, 0.45, 15);
    pointLight.position.set(-4, 3, -4);
    scene.add(pointLight);

    // 6. Build Grid Floor Board
    buildBoard();

    // 7. Resize event
    window.addEventListener('resize', onWindowResize, false);
}

function buildBoard() {
    boardGroup.clear();

    const boardWidth = GRID_COLS * GRID_SPACING;
    const boardHeight = GRID_ROWS * GRID_SPACING;

    // Outer stone bezel border
    const bezelGeom = new THREE.BoxGeometry(boardWidth + 0.4, 0.4, boardHeight + 0.4);
    const bezelMat = new THREE.MeshLambertMaterial({ color: 0x221a30 });
    const bezel = new THREE.Mesh(bezelGeom, bezelMat);
    bezel.position.y = -0.2; // top of bezel rests at Y=0 floor level
    bezel.receiveShadow = true;
    boardGroup.add(bezel);

    // Draw individual floor tiles (with tiny gaps to form grid lines)
    for (let x = 0; x < GRID_COLS; x++) {
        for (let y = 0; y < GRID_ROWS; y++) {
            const tileGeom = new THREE.BoxGeometry(GRID_SPACING - 0.08, 0.1, GRID_SPACING - 0.08);
            
            // Checkerboard slight shading variance
            const isDark = (x + y) % 2 === 0;
            const tileMat = new THREE.MeshLambertMaterial({ 
                color: isDark ? 0x161026 : 0x1c1430,
                emissive: PALETTE.boardGrid,
                emissiveIntensity: 0.12
            });

            const tile = new THREE.Mesh(tileGeom, tileMat);
            
            // Map grid index to world position
            const wx = (x - (GRID_COLS - 1) / 2) * GRID_SPACING;
            const wz = (y - (GRID_ROWS - 1) / 2) * GRID_SPACING;
            tile.position.set(wx, -0.05, wz);
            tile.receiveShadow = true;
            boardGroup.add(tile);
        }
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}


// --- DICE MATCHING & CHAINS REACTION LOGIC ---

// Find matches on the entire board (BFS search)
function checkAllMatches() {
    const visited = Array(GRID_COLS).fill(false).map(() => Array(GRID_ROWS).fill(false));
    let matchedAny = false;

    for (let x = 0; x < GRID_COLS; x++) {
        for (let y = 0; y < GRID_ROWS; y++) {
            const die = grid[x][y];
            if (!die || die.state !== 'normal' || visited[x][y]) continue;

            const targetVal = die.faces.top;
            
            // 1s cannot trigger a match on their own! Skip.
            if (targetVal === 1) continue;

            // Run Breadth-First Search to find connected component of identical face value
            const component = [];
            const queue = [[x, y]];
            visited[x][y] = true;

            while (queue.length > 0) {
                const [cx, cy] = queue.shift();
                component.push(grid[cx][cy]);

                // Look at 4 orthogonal neighbors
                const neighbors = [
                    [cx + 1, cy],
                    [cx - 1, cy],
                    [cx, cy + 1],
                    [cx, cy - 1]
                ];

                for (const [nx, ny] of neighbors) {
                    if (nx >= 0 && nx < GRID_COLS && ny >= 0 && ny < GRID_ROWS) {
                        const neighborDie = grid[nx][ny];
                        if (neighborDie && neighborDie.state === 'normal' && !visited[nx][ny] && neighborDie.faces.top === targetVal) {
                            visited[nx][ny] = true;
                            queue.push([nx, ny]);
                        }
                    }
                }
            }

            // Devil Dice Core Rule: Group size must be AT LEAST the value on top
            if (component.length >= targetVal) {
                // We matched a group!
                matchedAny = true;
                
                // Assign a unique group ID
                const groupId = Date.now() + Math.random().toString(36).substr(2, 5);
                
                // Transition all dice in component to sinking
                component.forEach(d => d.startSinking(groupId));
                
                // Add to active sinking groups tracker
                activeSinkingGroups.push({
                    id: groupId,
                    diceValue: targetVal,
                    diceList: component,
                    lastActivity: Date.now()
                });

                // Calculate points
                const points = targetVal * component.length * 100;
                score += points;
                updateScoreDisplay();
                AudioEngine.playMatch();

                // Trigger 3D floating score indicator
                createFloatingScore(component[0].gridX, component[0].gridY, `+${points}`);

                // Also immediately check if this match touches any other dice or 1s
                triggerChainEvaluations(groupId, targetVal);
            }
        }
    }

    // Now check if any 1s are touching any active sinking group!
    checkOnesChaining();
}

// Chain evaluation: Checks if any newly rolled/resting normal die connects to an active sinking group
function evaluateRollChain(rolledDie) {
    if (rolledDie.state !== 'normal') return;
    const rx = rolledDie.gridX;
    const ry = rolledDie.gridY;
    const rolledVal = rolledDie.faces.top;

    const neighbors = [
        [rx + 1, ry],
        [rx - 1, ry],
        [rx, ry + 1],
        [rx, ry - 1]
    ];

    for (const [nx, ny] of neighbors) {
        if (nx >= 0 && nx < GRID_COLS && ny >= 0 && ny < GRID_ROWS) {
            const neighborDie = grid[nx][ny];
            
            if (neighborDie && neighborDie.state === 'sinking') {
                const targetGroup = activeSinkingGroups.find(g => g.id === neighborDie.sinkingGroup);
                
                if (targetGroup) {
                    // Check Case 1: Rolled value matches the sinking group's matching value
                    if (rolledVal === targetGroup.diceValue && rolledVal !== 1) {
                        // Yes! Add to the chain
                        addDieToSinkingGroup(rolledDie, targetGroup);
                        return;
                    }
                    // Check Case 2: Rolled value is 1 (Power of 1s: can chain with ANY sinking group)
                    else if (rolledVal === 1) {
                        addDieToSinkingGroup(rolledDie, targetGroup);
                        return;
                    }
                }
            }
        }
    }
}

// Internal: Chain addition
function addDieToSinkingGroup(die, group) {
    die.startSinking(group.id);
    group.diceList.push(die);
    group.lastActivity = Date.now();

    // Reset sinking timers of all dice in the group to extend its life!
    group.diceList.forEach(d => {
        d.sinkingTimer = Date.now();
    });

    // Combo multiplier reward
    comboCount++;
    showComboBanner();

    const comboPoints = comboCount * 250;
    score += comboPoints;
    updateScoreDisplay();
    AudioEngine.playCombo(comboCount);

    createFloatingScore(die.gridX, die.gridY, `COMBO +${comboPoints}`);
    
    // Check if adding this die (especially a 1) triggers further chain reactions
    checkOnesChaining();
}

// Power of 1s: Check if any normal 1s are adjacent to ANY sinking dice, if so chain them recursively
function checkOnesChaining() {
    let chainedAnyOne = false;

    for (let x = 0; x < GRID_COLS; x++) {
        for (let y = 0; y < GRID_ROWS; y++) {
            const die = grid[x][y];
            if (die && die.state === 'normal' && die.faces.top === 1) {
                // Look for neighboring sinking dice
                const neighbors = [
                    [x + 1, y],
                    [x - 1, y],
                    [x, y + 1],
                    [x, y - 1]
                ];

                for (const [nx, ny] of neighbors) {
                    if (nx >= 0 && nx < GRID_COLS && ny >= 0 && ny < GRID_ROWS) {
                        const neighborDie = grid[nx][ny];
                        if (neighborDie && neighborDie.state === 'sinking') {
                            const group = activeSinkingGroups.find(g => g.id === neighborDie.sinkingGroup);
                            if (group) {
                                addDieToSinkingGroup(die, group);
                                chainedAnyOne = true;
                                break; // exit neighbors, evaluate next die
                            }
                        }
                    }
                }
            }
        }
    }

    // Recurse once if we chained a 1, because that 1 might now touch another 1!
    if (chainedAnyOne) {
        checkOnesChaining();
    }
}

// Triggered on new matches to automatically absorb adjacent identical dice that weren't part of BFS (e.g., adjacent to edge)
function triggerChainEvaluations(groupId, diceValue) {
    const group = activeSinkingGroups.find(g => g.id === groupId);
    if (!group) return;

    let searchAgain = true;
    while (searchAgain) {
        searchAgain = false;
        
        // Scan current list members and check their neighbors
        for (const gd of group.diceList) {
            const neighbors = [
                [gd.gridX + 1, gd.gridY],
                [gd.gridX - 1, gd.gridY],
                [gd.gridX, gd.gridY + 1],
                [gd.gridX, gd.gridY - 1]
            ];

            for (const [nx, ny] of neighbors) {
                if (nx >= 0 && nx < GRID_COLS && ny >= 0 && ny < GRID_ROWS) {
                    const candidate = grid[nx][ny];
                    if (candidate && candidate.state === 'normal' && (candidate.faces.top === diceValue || candidate.faces.top === 1)) {
                        candidate.startSinking(groupId);
                        group.diceList.push(candidate);
                        searchAgain = true;
                        
                        // Add scoring
                        const points = diceValue * 100;
                        score += points;
                        updateScoreDisplay();
                        createFloatingScore(nx, ny, `+${points}`);
                    }
                }
            }
            if (searchAgain) break; // restart scan loop with expanded list
        }
    }
}

// Core frame update of all sinking dice
function updateSinkingDice() {
    for (let i = activeSinkingGroups.length - 1; i >= 0; i--) {
        const group = activeSinkingGroups[i];
        
        // Update all individual dice inside group
        let allSunk = true;
        group.diceList.forEach(d => {
            const finished = d.updateSinking();
            if (!finished) allSunk = false;
        });

        // Check if player is standing on any die in this sinking group
        // If they are, make sure their Y height is aligned to the sinking die!
        if (player && player.height === 1.0) {
            const standingDie = grid[player.gridX][player.gridY];
            if (standingDie && standingDie.sinkingGroup === group.id) {
                player.group.position.y = standingDie.height + 1.0; // rest on top of sinking die
            }
        }

        if (allSunk) {
            // Sinking complete for entire group! Clean up.
            activeSinkingGroups.splice(i, 1);
            
            // If player was standing on one of these, make them fall to floor!
            if (player && player.height === 1.0) {
                const standingDie = grid[player.gridX][player.gridY];
                if (!standingDie) {
                    player.height = 0.0;
                    player.update3DPosition();
                }
            }
        }
    }
}


// --- SPAWNING SYSTEM (TRIAL MODE) ---

function spawnRandomDie() {
    if (gameState !== 'playing') return;

    // 1. Gather all empty grid slots (no normal, rising, or sinking die)
    const emptySlots = [];
    for (let x = 0; x < GRID_COLS; x++) {
        for (let y = 0; y < GRID_ROWS; y++) {
            if (grid[x][y] === null) {
                emptySlots.push({ x, y });
            }
        }
    }

    // Safety guard: Board completely filled checks
    const activeDiceCount = countActiveDice();
    const fullness = activeDiceCount / totalCells;
    updateFullnessBar(fullness);

    if (emptySlots.length === 0) {
        triggerGameOver();
        return;
    }

    // 2. Select random empty slot and spawn a new rising die
    const slot = emptySlots[Math.floor(Math.random() * emptySlots.length)];
    const newDie = new Die(slot.x, slot.y);
    grid[slot.x][slot.y] = newDie;

    // If player was standing on the empty floor where the die rose, lift them!
    if (player && player.gridX === slot.x && player.gridY === slot.y && player.height === 0.0) {
        player.height = 1.0; // stand on top of rising die
        player.update3DPosition();
    }

    // Schedule next spawn with slight speed up over time (progressive tension!)
    const baseInterval = DIFFICULTY_SETTINGS[selectedDifficulty].spawnInterval;
    const progressiveSpeedup = Math.max(0.65, 1.0 - (score / 150000)); // up to 35% faster at high scores
    const finalInterval = baseInterval * progressiveSpeedup;

    spawnTimerId = setTimeout(spawnRandomDie, finalInterval);
}

function stopSpawning() {
    if (spawnTimerId) {
        clearTimeout(spawnTimerId);
        spawnTimerId = null;
    }
}

function countActiveDice() {
    let count = 0;
    for (let x = 0; x < GRID_COLS; x++) {
        for (let y = 0; y < GRID_ROWS; y++) {
            if (grid[x][y] !== null) count++;
        }
    }
    return count;
}


// --- 3D FLOATING SCORE INDICATORS ---
function createFloatingScore(gridX, gridY, text) {
    // We render a beautiful 2D DOM element overlaid exactly on the 3D position!
    // This looks much sharper and is 100% responsive.
    const wx = (gridX - (GRID_COLS - 1) / 2) * GRID_SPACING;
    const wz = (gridY - (GRID_ROWS - 1) / 2) * GRID_SPACING;
    const pos3D = new THREE.Vector3(wx, 0.8, wz);

    const el = document.createElement('div');
    el.className = 'floating-score';
    el.innerText = text;
    document.getElementById('ui-container').appendChild(el);

    // Update screen coordinates in animation frame
    const startTime = Date.now();
    const duration = 1200;

    const animateFloat = () => {
        const elapsed = Date.now() - startTime;
        const progress = elapsed / duration;

        if (progress >= 1.0 || gameState === 'menu') {
            if (el.parentNode) el.parentNode.removeChild(el);
            return;
        }

        // Lift float position upwards along Y
        const currentPos = pos3D.clone();
        currentPos.y += progress * 1.5;

        // Project 3D vector to 2D screen coordinate space
        currentPos.project(camera);

        const x = (currentPos.x * .5 + .5) * window.innerWidth;
        const y = (-(currentPos.y * .5) + .5) * window.innerHeight;

        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.style.opacity = 1.0 - progress;
        el.style.transform = `translate(-50%, -50%) scale(${1 + progress * 0.3})`;

        requestAnimationFrame(animateFloat);
    };

    requestAnimationFrame(animateFloat);
}


// --- GAME STATE FLOW MANAGERS ---

function populateInitialBoard() {
    // Clear old state
    for (let x = 0; x < GRID_COLS; x++) {
        for (let y = 0; y < GRID_ROWS; y++) {
            if (grid[x][y]) {
                diceGroup.remove(grid[x][y].mesh);
                grid[x][y].mesh.geometry.dispose();
            }
        }
    }
    grid = Array(GRID_COLS).fill(null).map(() => Array(GRID_ROWS).fill(null));
    activeSinkingGroups = [];

    // Select amount of initial starting dice
    const numDice = DIFFICULTY_SETTINGS[selectedDifficulty].initialDice;
    let placed = 0;

    // Standard initial cluster: place dice ensuring we don't block center (3,3) where player starts
    const centerMargin = 1;
    
    while (placed < numDice) {
        const x = Math.floor(Math.random() * GRID_COLS);
        const y = Math.floor(Math.random() * GRID_ROWS);

        // Don't place on center start block or duplicates
        if (x === 3 && y === 3) continue;
        if (grid[x][y] !== null) continue;

        const d = new Die(x, y);
        // Instant surface entry for initial dice
        d.state = 'normal';
        d.height = 0.0;
        d.mesh.material = getDiceMaterials(d.faces, 'normal');
        d.updateMeshPosition();

        grid[x][y] = d;
        placed++;
    }

    // Run a clean check, if by freak random chance we generated pre-matched clusters, clear them
    checkAllMatches();
}

function startGame() {
    AudioEngine.init();
    gameState = 'playing';
    score = 0;
    comboCount = 0;
    updateScoreDisplay();
    hideComboBanner();

    // UI Panel shift
    document.getElementById('menu-screen').classList.remove('active');
    document.getElementById('pause-screen').classList.remove('active');
    document.getElementById('gameover-screen').classList.remove('active');
    document.getElementById('hud-screen').classList.add('active');

    // Build scene
    populateInitialBoard();

    // Create player character at grid center (3,3) on floor level
    if (player) {
        scene.remove(player.group);
    }
    player = new Player(3, 3);

    // Initial capacity display
    const activeCount = countActiveDice();
    updateFullnessBar(activeCount / totalCells);

    // Start spawning thread
    stopSpawning();
    const config = DIFFICULTY_SETTINGS[selectedDifficulty];
    spawnTimerId = setTimeout(spawnRandomDie, config.spawnInterval);

    // Music
    AudioEngine.stopBGM();
    if (musicEnabled) {
        AudioEngine.startBGM();
    }
}

function pauseGame() {
    if (gameState !== 'playing') return;
    gameState = 'paused';
    stopSpawning();
    AudioEngine.stopBGM();

    document.getElementById('hud-screen').classList.remove('active');
    document.getElementById('pause-screen').classList.add('active');
}

function resumeGame() {
    if (gameState !== 'paused') return;
    gameState = 'playing';

    document.getElementById('pause-screen').classList.remove('active');
    document.getElementById('hud-screen').classList.add('active');

    // Resume spawn loop
    const config = DIFFICULTY_SETTINGS[selectedDifficulty];
    spawnTimerId = setTimeout(spawnRandomDie, config.spawnInterval);

    if (musicEnabled) {
        AudioEngine.startBGM();
    }
}

function quitToMenu() {
    gameState = 'menu';
    stopSpawning();
    AudioEngine.stopBGM();

    document.getElementById('pause-screen').classList.remove('active');
    document.getElementById('gameover-screen').classList.remove('active');
    document.getElementById('hud-screen').classList.remove('active');
    document.getElementById('menu-screen').classList.add('active');

    // Refresh menu highscore
    document.getElementById('menu-highscore').innerText = Number(highScore).toLocaleString();

    // Clear 3D groups
    for (let x = 0; x < GRID_COLS; x++) {
        for (let y = 0; y < GRID_ROWS; y++) {
            if (grid[x][y]) {
                diceGroup.remove(grid[x][y].mesh);
                grid[x][y].mesh.geometry.dispose();
            }
        }
    }
    grid = Array(GRID_COLS).fill(null).map(() => Array(GRID_ROWS).fill(null));
    if (player) {
        scene.remove(player.group);
        player = null;
    }
}

function triggerGameOver() {
    gameState = 'gameover';
    stopSpawning();
    AudioEngine.stopBGM();
    AudioEngine.playGameOver();

    // Save High Score
    let isNewHigh = false;
    if (score > highScore) {
        highScore = score;
        localStorage.setItem('devildice_highscore', highScore);
        isNewHigh = true;
    }

    // Populate Game Over Stats
    document.getElementById('go-score').innerText = score.toLocaleString();
    document.getElementById('go-combo').innerText = comboCount.toString();
    document.getElementById('new-high-indicator').style.display = isNewHigh ? 'block' : 'none';

    document.getElementById('hud-screen').classList.remove('active');
    document.getElementById('gameover-screen').classList.add('active');
}


// --- UI DISPLAY REFRESHERS ---

function updateScoreDisplay() {
    document.getElementById('hud-score').innerText = score.toLocaleString().padStart(7, '0');
    document.getElementById('hud-highscore').innerText = highScore.toLocaleString().padStart(7, '0');
}

function updateFullnessBar(percentage) {
    const bar = document.getElementById('capacity-bar');
    const warningText = document.getElementById('capacity-warning');
    
    // Scale width
    bar.style.width = `${percentage * 100}%`;

    // Red alert pulsation if board is dangerously full (>80%)
    if (percentage >= 0.8) {
        warningText.classList.add('danger-alarm');
        bar.style.boxShadow = '0 0 10px #ff3366';
    } else {
        warningText.classList.remove('danger-alarm');
        bar.style.boxShadow = 'none';
    }
}

let comboTimerId = null;
function showComboBanner() {
    const banner = document.getElementById('combo-display');
    document.getElementById('combo-count').innerText = comboCount.toString();
    
    banner.classList.remove('combo-hide');

    // Hide banner after 2.5 seconds of inactivity
    if (comboTimerId) clearTimeout(comboTimerId);
    comboTimerId = setTimeout(() => {
        banner.classList.add('combo-hide');
    }, 2500);
}

function hideComboBanner() {
    document.getElementById('combo-display').classList.add('combo-hide');
}


// --- INTERFACE INPUT LISTENERS ---

// Map keyboard arrow codes and WASD
function handleKeyboard(e) {
    if (gameState !== 'playing' || !player) return;

    let key = e.key.toLowerCase();
    
    // Direct diagonal mappings for intuitive desktop play
    if (key === 'arrowup' || key === 'w') {
        player.attemptMove('ul'); // North (-Z)
    } else if (key === 'arrowright' || key === 'd') {
        player.attemptMove('ur'); // East (+X)
    } else if (key === 'arrowdown' || key === 's') {
        player.attemptMove('dr'); // South (+Z)
    } else if (key === 'arrowleft' || key === 'a') {
        player.attemptMove('dl'); // West (-X)
    } else if (key === ' ' || key === 'enter') {
        // Space/Enter mapping for climb/descend toggle
        if (player.height === 1.0) {
            player.descendManual();
        } else {
            // Player is on floor, climbing happens automatically on collision, 
            // but manual override will climb facing die
            const targetX = player.gridX + Math.round(player.facingDir.x);
            const targetY = player.gridY + Math.round(player.facingDir.y);
            if (targetX >= 0 && targetX < GRID_COLS && targetY >= 0 && targetY < GRID_ROWS) {
                const targetDie = grid[targetX][targetY];
                if (targetDie) {
                    player.climbOnto(targetX, targetY);
                }
            }
        }
    } else if (key === 'p' || key === 'escape') {
        pauseGame();
    }
}

// Map screen button triggers
function setupControlListeners() {
    // 1. Desktop Keyboard
    window.addEventListener('keydown', handleKeyboard);

    // 2. Touch Diagonal D-Pad
    const dpadBtns = document.querySelectorAll('.dpad-btn');
    dpadBtns.forEach(btn => {
        // Handle both touch start (fast) and mouse click fallback
        const triggerDir = (e) => {
            e.preventDefault();
            if (gameState !== 'playing' || !player) return;
            const dir = btn.getAttribute('data-dir');
            player.attemptMove(dir);
        };
        btn.addEventListener('touchstart', triggerDir, { passive: false });
        btn.addEventListener('mousedown', triggerDir);
    });

    // 3. Touch Climb / Action Button
    const climbBtn = document.getElementById('climb-btn');
    const triggerClimb = (e) => {
        e.preventDefault();
        if (gameState !== 'playing' || !player) return;
        
        if (player.height === 1.0) {
            player.descendManual();
        } else {
            // Find face die
            const targetX = player.gridX + Math.round(player.facingDir.x);
            const targetY = player.gridY + Math.round(player.facingDir.y);
            if (targetX >= 0 && targetX < GRID_COLS && targetY >= 0 && targetY < GRID_ROWS) {
                const targetDie = grid[targetX][targetY];
                if (targetDie) {
                    player.climbOnto(targetX, targetY);
                }
            }
        }
    };
    climbBtn.addEventListener('touchstart', triggerClimb, { passive: false });
    climbBtn.addEventListener('mousedown', triggerClimb);

    // 4. Touch swipe gesture support directly on the canvas viewport
    setupSwipeDetection();

    // 5. Menu HUD Button Links
    document.getElementById('start-btn').addEventListener('click', startGame);
    document.getElementById('how-to-btn').addEventListener('click', () => {
        document.getElementById('how-to-modal').classList.add('active');
    });
    document.getElementById('close-how-to').addEventListener('click', () => {
        document.getElementById('how-to-modal').classList.remove('active');
    });
    document.getElementById('settings-btn').addEventListener('click', () => {
        // Load values
        document.getElementById('control-mode').value = controlMode;
        document.getElementById('sound-toggle').checked = soundEnabled;
        document.getElementById('music-toggle').checked = musicEnabled;
        document.getElementById('difficulty').value = selectedDifficulty;

        document.getElementById('settings-modal').classList.add('active');
    });
    document.getElementById('close-settings').addEventListener('click', () => {
        // Save values
        controlMode = document.getElementById('control-mode').value;
        soundEnabled = document.getElementById('sound-toggle').checked;
        
        const musicChecked = document.getElementById('music-toggle').checked;
        if (musicChecked !== musicEnabled) {
            musicEnabled = musicChecked;
            if (gameState === 'playing') {
                if (musicEnabled) AudioEngine.startBGM();
                else AudioEngine.stopBGM();
            }
        }

        selectedDifficulty = document.getElementById('difficulty').value;

        // Apply UI visibility depending on touch preference settings
        const dpad = document.querySelector('.dpad-container');
        if (controlMode === 'swipe') {
            dpad.style.display = 'none';
        } else {
            dpad.style.display = 'block';
        }

        document.getElementById('settings-modal').classList.remove('active');
    });

    document.getElementById('pause-btn').addEventListener('click', pauseGame);
    document.getElementById('resume-btn').addEventListener('click', resumeGame);
    document.getElementById('restart-pause-btn').addEventListener('click', () => {
        startGame();
    });
    document.getElementById('quit-btn').addEventListener('click', quitToMenu);

    document.getElementById('retry-btn').addEventListener('click', startGame);
    document.getElementById('menu-quit-btn').addEventListener('click', quitToMenu);
}

// Swipe detection logic
function setupSwipeDetection() {
    let touchStartX = 0;
    let touchStartY = 0;
    const threshold = 35; // minimum px movement to register swipe

    const container = document.getElementById('game-container');

    container.addEventListener('touchstart', (e) => {
        if (gameState !== 'playing' || controlMode === 'diagonal') return;
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    container.addEventListener('touchend', (e) => {
        if (gameState !== 'playing' || controlMode === 'diagonal' || !player) return;

        const touchEndX = e.changedTouches[0].screenX;
        const touchEndY = e.changedTouches[0].screenY;

        const dx = touchEndX - touchStartX;
        const dy = touchEndY - touchStartY;

        const absX = Math.abs(dx);
        const absY = Math.abs(dy);

        if (absX < threshold && absY < threshold) return; // tap, not swipe

        // Resolve swipe direction mapping (aligned with isometric screen coordinates)
        if (absX > absY) {
            // Horizontal sweep dominant
            if (dx > 0) {
                // Swipe Right -> maps to South-East (Down-Right) or North-East (Up-Right)
                // Let's resolve angle
                if (dy > 0) player.attemptMove('dr'); // South-East
                else player.attemptMove('ur'); // North-East
            } else {
                // Swipe Left -> maps to South-West (Down-Left) or North-West (Up-Left)
                if (dy > 0) player.attemptMove('dl'); // South-West
                else player.attemptMove('ul'); // North-West
            }
        } else {
            // Vertical sweep dominant
            if (dy > 0) {
                // Swipe Down
                if (dx > 0) player.attemptMove('dr'); // South-East
                else player.attemptMove('dl'); // South-West
            } else {
                // Swipe Up
                if (dx > 0) player.attemptMove('ur'); // North-East
                else player.attemptMove('ul'); // North-West
            }
        }
    }, { passive: true });
}


// --- THE REALTIME MAIN LOOP ---
let lastTime = Date.now();

function gameLoop() {
    requestAnimationFrame(gameLoop);

    const now = Date.now();
    const deltaTime = (now - lastTime) / 1000.0;
    lastTime = now;

    // Render continuous 3D frame
    if (renderer && scene && camera) {
        renderer.render(scene, camera);
    }

    if (gameState === 'playing') {
        // 1. Process Sinking Dice ticks
        updateSinkingDice();

        // 2. Animate subtle hover bobs on player head & cape for visual life
        if (player) {
            const time = now * 0.005;
            player.headMesh.position.y = 0.6 + Math.sin(time) * 0.012;
            player.leftHorn.position.y = 0.74 + Math.sin(time) * 0.012;
            player.rightHorn.position.y = 0.74 + Math.sin(time) * 0.012;
            player.capeMesh.rotation.x = 0.1 + Math.sin(time * 0.5) * 0.05;
        }

        // 3. Keep updating Board fullness capacity bar
        const activeCount = countActiveDice();
        const fullness = activeCount / totalCells;
        updateFullnessBar(fullness);
    }
}


// --- STARTUP KICKOFF ---
window.onload = () => {
    // Show high score from memory immediately
    document.getElementById('menu-highscore').innerText = Number(highScore).toLocaleString();

    // Init Three.js and Board elements
    initEngine();
    
    // Wire UI click hooks
    setupControlListeners();

    // Fire continuous render/game loop thread
    gameLoop();
};
