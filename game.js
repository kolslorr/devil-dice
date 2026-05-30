/**
 * Devil Dice 3D - Spec-Compliant Game Engine
 * Tactile gesture-based 3D dice puzzle. Three.js + Pointer Events.
 * No character avatar - direct dice interaction per html_instructions.md.
 */
"use strict";
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
        navigator.serviceWorker.register('./sw.js')
            .then(function(reg) { console.log('SW registered'); })
            .catch(function(err) { console.error('SW failed', err); });
    });
}
var GRID_COLS = 7, GRID_ROWS = 7, GRID_SPACING = 1.3, DIE_SCALE = 1.0;
var ROLL_DURATION = 220, SLIDE_DURATION = 180, SINK_DURATION = 5500;
var HOLD_THRESHOLD = 200, SWIPE_THRESHOLD = 18;
var DIFFICULTY_SETTINGS = {
    easy: { spawnInterval: 9000, diceRatio: 0.25 },
    medium: { spawnInterval: 6500, diceRatio: 0.35 },
    hard: { spawnInterval: 4000, diceRatio: 0.45 }
};
var BOARD_PRESETS = {
    '7x7': { cols: 7, rows: 7 }, '5x9': { cols: 5, rows: 9 },
    '5x11': { cols: 5, rows: 11 }, '9x5': { cols: 9, rows: 5 }
};
var INITIAL_DIE_FACES = { top: 1, bottom: 6, front: 2, back: 5, left: 4, right: 3 };
var STANDARD_ORIENTATIONS = {
    1: { top: 1, bottom: 6, front: 2, back: 5, left: 4, right: 3 },
    2: { top: 2, bottom: 5, front: 6, back: 1, left: 4, right: 3 },
    3: { top: 3, bottom: 4, front: 2, back: 5, left: 1, right: 6 },
    4: { top: 4, bottom: 3, front: 2, back: 5, left: 6, right: 1 },
    5: { top: 5, bottom: 2, front: 1, back: 6, left: 4, right: 3 },
    6: { top: 6, bottom: 1, front: 5, back: 2, left: 4, right: 3 }
};
var DIRECTIONS = { north: { dx: 0, dy: -1 }, south: { dx: 0, dy: 1 }, east: { dx: 1, dy: 0 }, west: { dx: -1, dy: 0 } };
var PALETTE = {
    boardFloor: 0x140e21, boardGrid: 0x4a3266,
    normalDie: { bg: '#231c30', pips: '#00ff66', border: '#403454' },
    sinkingDie: { bg: '#990033', pips: '#ffffff', border: '#ff3366' },
    risingDie: { bg: '#0e2b45', pips: '#33ccff', border: '#1f5380' },
    sinkingOne: { bg: '#ffffff', pips: '#ff3366', border: '#ff88aa' },
    lockedBlock: { bg: '#2a2a2a', pips: '#666666', border: '#444444' },
    hoverGlow: { bg: '#3a2a50', pips: '#44ff88', border: '#8877aa' }
};
var CELL_TYPE = { EMPTY: 0, ACTIVE: 1, LOCKED: 2 };
var scene, camera, renderer, diceGroup, boardGroup, worldGroup;
var grid = [], score = 0, comboCount = 0;
var sinkingHighlights = [];
var highScore = localStorage.getItem('devildice_zen_hs') ? parseInt(localStorage.getItem('devildice_zen_hs')) : 0;
var gameState = 'menu', gameMode = 'zen', selectedDifficulty = 'medium', aiDifficulty = 'medium';
var soundEnabled = true, musicEnabled = false, spawnTimerId = null, activeSinkingGroups = [];
var totalCells = GRID_COLS * GRID_ROWS, boardSize = '7x7', animationLock = false;
var puzzleMovesRemaining = 0, puzzleCleared = false, puzzleStage = 1, puzzleMaxStages = 10;
var aiTickInterval = null;
var battlePlayerScore = 0, battleAiScore = 0;
var battleTimeRemaining = 180, battleTimerId = null, battleDuration = 180;
var battleCurrentTurn = null;
var battlePlayerFrozenUntil = 0, battleAiFrozenUntil = 0;
var audioCtx = null, bgmGain = null, bgmIntervalId = null;
var textureCache = {}, materialsCache = {};

var AudioEngine = {
    init: function() { if (audioCtx) return; try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {} },
    playTone: function(freq, type, dur, gainVal, slideTo) {
        if (!soundEnabled || !audioCtx) return; this.init();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = type; o.frequency.setValueAtTime(freq, audioCtx.currentTime);
        if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, audioCtx.currentTime + dur);
        g.gain.setValueAtTime(gainVal, audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
        o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + dur);
    },
    playMove: function() { this.playTone(150, 'triangle', 0.08, 0.2, 50); },
    playRoll: function() {
        if (!soundEnabled || !audioCtx) return; this.init();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        var t = audioCtx.currentTime, dur = 0.2;
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'triangle'; o.frequency.setValueAtTime(90, t);
        o.frequency.exponentialRampToValueAtTime(45, t + dur);
        g.gain.setValueAtTime(0.32, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + dur);
        var bs = Math.floor(audioCtx.sampleRate * dur), nb = audioCtx.createBuffer(1, bs, audioCtx.sampleRate), nd = nb.getChannelData(0);
        for (var i = 0; i < bs; i++) nd[i] = Math.random() * 2 - 1;
        var ns = audioCtx.createBufferSource(); ns.buffer = nb;
        var nf = audioCtx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 400; nf.Q.value = 0.7;
        var ng = audioCtx.createGain(); ng.gain.setValueAtTime(0.18, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.6);
        ns.connect(nf); nf.connect(ng); ng.connect(audioCtx.destination); ns.start(t); ns.stop(t + dur);
    },
    playSlide: function() { this.playTone(120, 'triangle', 0.2, 0.18, 70); },
    playHaptic: function() { if (navigator.vibrate) navigator.vibrate(15); },
    playMatch: function() { [261.63, 329.63, 392, 523.25].forEach(function(f, i) { setTimeout(function() { AudioEngine.playTone(f, 'sine', 0.3, 0.15, f * 1.5); }, i * 60); }); },
    playCombo: function(c) { var m = 1 + c * 0.1; this.playTone(880 * m, 'sine', 0.4, 0.2, 1200 * m); },
    playGameOver: function() { [392, 349.23, 311.13, 246.94].forEach(function(f, i) { setTimeout(function() { AudioEngine.playTone(f, 'triangle', 0.5, 0.2, f * 0.5); }, i * 150); }); },
    playWin: function() { [261.63, 329.63, 392, 523.25, 659.25].forEach(function(f, i) { setTimeout(function() { AudioEngine.playTone(f, 'sine', 0.35, 0.18, f * 1.3); }, i * 100); }); },
    playLockBlock: function() { this.playTone(80, 'square', 0.3, 0.25, 40); },
    startBGM: function() {
        if (!musicEnabled) return; this.init(); if (audioCtx.state === 'suspended') audioCtx.resume();
        bgmGain = audioCtx.createGain(); bgmGain.gain.setValueAtTime(0.04, audioCtx.currentTime); bgmGain.connect(audioCtx.destination);
        var step = 0, melody = [130.81, 164.81, 196, 164.81, 146.83, 174.61, 220, 174.61];
        bgmIntervalId = setInterval(function() {
            if (!musicEnabled || !audioCtx) return;
            var o = audioCtx.createOscillator(); o.type = 'triangle';
            o.frequency.setValueAtTime(melody[step % melody.length], audioCtx.currentTime);
            o.connect(bgmGain); o.start(); o.stop(audioCtx.currentTime + 0.35);
            if (step % 2 === 0) AudioEngine.playNoise(0.05, 0.015); step++;
        }, 400);
    },
    stopBGM: function() { if (bgmIntervalId) { clearInterval(bgmIntervalId); bgmIntervalId = null; } if (bgmGain) { bgmGain.disconnect(); bgmGain = null; } },
    playNoise: function(dur, gainVal) {
        if (!soundEnabled || !audioCtx) return;
        var bs = audioCtx.sampleRate * dur, b = audioCtx.createBuffer(1, bs, audioCtx.sampleRate), d = b.getChannelData(0);
        for (var i = 0; i < bs; i++) d[i] = Math.random() * 2 - 1;
        var n = audioCtx.createBufferSource(); n.buffer = b;
        var f = audioCtx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 5000;
        var g = audioCtx.createGain(); g.gain.setValueAtTime(gainVal, audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
        n.connect(f); f.connect(g); g.connect(audioCtx.destination); n.start();
    }
};

function getDiceTexture(value, state, rot) {
    rot = rot || 0; state = state || 'normal'; var ck = value + '_' + state + '_r' + rot; if (textureCache[ck]) return textureCache[ck];
    var cv = document.createElement('canvas'); cv.width = 128; cv.height = 128; var ctx = cv.getContext('2d');
    var colors = PALETTE.normalDie;
    if (state === 'sinking') colors = PALETTE.sinkingDie; if (state === 'rising') colors = PALETTE.risingDie;
    if (state === 'sinking_one') colors = PALETTE.sinkingOne; if (state === 'locked') colors = PALETTE.lockedBlock;
    if (state === 'hover') colors = PALETTE.hoverGlow;
    ctx.fillStyle = colors.border; ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = colors.bg; var r = 12, m = 6;
    ctx.beginPath(); ctx.moveTo(m + r, m); ctx.lineTo(128 - m - r, m);
    ctx.quadraticCurveTo(128 - m, m, 128 - m, m + r); ctx.lineTo(128 - m, 128 - m - r);
    ctx.quadraticCurveTo(128 - m, 128 - m, 128 - m - r, 128 - m); ctx.lineTo(m + r, 128 - m);
    ctx.quadraticCurveTo(m, 128 - m, m, 128 - m - r); ctx.lineTo(m, m + r);
    ctx.quadraticCurveTo(m, m, m + r, m); ctx.closePath(); ctx.fill();
    var grad = ctx.createRadialGradient(64, 64, 10, 64, 64, 60);
    grad.addColorStop(0, 'rgba(255,255,255,0.05)'); grad.addColorStop(1, 'rgba(0,0,0,0.35)'); ctx.fillStyle = grad; ctx.fill();
    ctx.fillStyle = colors.pips; ctx.shadowBlur = 8; ctx.shadowColor = colors.pips;
    var pipR = 10, pad = 32;
    var pos = { c: [64, 64], tl: [pad, pad], tr: [128 - pad, pad], bl: [pad, 128 - pad], br: [128 - pad, 128 - pad], ml: [pad, 64], mr: [128 - pad, 64] };
    function dp(p) { ctx.beginPath(); ctx.arc(p[0], p[1], pipR, 0, Math.PI * 2); ctx.fill(); }
    switch (value) { case 1: dp(pos.c); break; case 2: dp(pos.tl); dp(pos.br); break; case 3: dp(pos.tl); dp(pos.c); dp(pos.br); break; case 4: dp(pos.tl); dp(pos.tr); dp(pos.bl); dp(pos.br); break; case 5: dp(pos.tl); dp(pos.tr); dp(pos.c); dp(pos.bl); dp(pos.br); break; case 6: dp(pos.tl); dp(pos.tr); dp(pos.ml); dp(pos.mr); dp(pos.bl); dp(pos.br); break; }
    if (rot > 0) { var rcv = document.createElement('canvas'); rcv.width = 128; rcv.height = 128; var rctx = rcv.getContext('2d'); rctx.translate(64, 64); rctx.rotate(rot * Math.PI / 2); rctx.drawImage(cv, -64, -64); cv = rcv; }
    var tex = new THREE.CanvasTexture(cv); textureCache[ck] = tex; return tex;
}

function getDiceMaterials(faces, state) {
    state = state || 'normal';
    var key = faces.right + '_' + faces.left + '_' + faces.top + '_' + faces.bottom + '_' + faces.back + '_' + faces.front + '_' + state + '_v3';
    if (materialsCache[key]) return materialsCache[key];
    var mats = [
        new THREE.MeshLambertMaterial({ map: getDiceTexture(faces.right, state, 0) }),
        new THREE.MeshLambertMaterial({ map: getDiceTexture(faces.left, state, 0) }),
        new THREE.MeshLambertMaterial({ map: getDiceTexture(faces.top, state, 1) }),
        new THREE.MeshLambertMaterial({ map: getDiceTexture(faces.bottom, state, 1) }),
        new THREE.MeshLambertMaterial({ map: getDiceTexture(faces.front, state, 0) }),
        new THREE.MeshLambertMaterial({ map: getDiceTexture(faces.back, state, 0) })
    ];
    if (state === 'sinking' || state === 'sinking_one') mats.forEach(function(m) { m.transparent = true; m.opacity = 1.0; });
    materialsCache[key] = mats; return mats;
}

function Die(gridX, gridY, topValue, cellType) {
    this.gridX = gridX; this.gridY = gridY;
    this.cellType = (typeof cellType === 'undefined') ? CELL_TYPE.ACTIVE : cellType;
    this.state = (this.cellType === CELL_TYPE.LOCKED) ? 'locked' : 'rising';
    this.height = (this.cellType === CELL_TYPE.LOCKED) ? 0.0 : -1.0;
    this.sinkingGroup = null; this.sinkingTimer = 0;
    this.faces = Object.assign({}, INITIAL_DIE_FACES);
    if (this.cellType === CELL_TYPE.LOCKED) { this.faces = { top: 0, bottom: 0, front: 0, back: 0, left: 0, right: 0 }; }
    else if (typeof topValue !== 'undefined' && topValue !== null && topValue !== 1) { this.forceTopValue(topValue); }
    else if (typeof topValue === 'undefined' || topValue === null) { this.forceTopValue(Math.floor(Math.random() * 6) + 1); }
    this.pivotGroup = new THREE.Group();
    var geom = new THREE.BoxGeometry(DIE_SCALE, DIE_SCALE, DIE_SCALE);
    this.materials = (this.cellType === CELL_TYPE.LOCKED) ? getDiceMaterials(this.faces, 'locked') : getDiceMaterials(this.faces, 'rising');
    this.mesh = new THREE.Mesh(geom, this.materials); this.mesh.userData.die = this;
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.pivotGroup.add(this.mesh); diceGroup.add(this.pivotGroup);
    this._syncPivot();
    if (this.cellType === CELL_TYPE.LOCKED) { this.state = 'locked'; this.height = 0.0; this._syncPivot(); }
    else { this.animateRise(); }
}
Object.defineProperty(Die.prototype, 'topFace', { get: function() { return this.faces.top; } });
Object.defineProperty(Die.prototype, 'northFace', { get: function() { return this.faces.back; } });
Object.defineProperty(Die.prototype, 'eastFace', { get: function() { return this.faces.right; } });
Die.prototype.forceTopValue = function(targetTop) {
    if (this.faces.top === targetTop) return;
    this.faces = Object.assign({}, STANDARD_ORIENTATIONS[targetTop]);
    var rots = Math.floor(Math.random() * 4); for (var i = 0; i < rots; i++) this._rotY();
};
Die.prototype._rotY = function() { var t = this.faces.front; this.faces.front = this.faces.right; this.faces.right = this.faces.back; this.faces.back = this.faces.left; this.faces.left = t; };
Die.prototype.setHover = function(active) {
    if (this.cellType === CELL_TYPE.LOCKED) return;
    if (active && this.state === 'normal') this.mesh.material = getDiceMaterials(this.faces, 'hover');
    else if (this.state === 'normal') this.mesh.material = getDiceMaterials(this.faces, 'normal');
};
Die.prototype._syncPivot = function() {
    var wx = (this.gridX - (GRID_COLS - 1) / 2) * GRID_SPACING, wz = (this.gridY - (GRID_ROWS - 1) / 2) * GRID_SPACING;
    var wy = (this.height - 0.5) + DIE_SCALE / 2;
    this.pivotGroup.position.set(wx, wy, wz); this.pivotGroup.rotation.set(0, 0, 0); this.mesh.position.set(0, 0, 0);
};
Die.prototype.updateMeshPosition = function() { this._syncPivot(); };
Die.prototype.animateRise = function() {
    var self = this, startTime = Date.now(), duration = 1500;
    function tick() {
        if (gameState === 'paused' || self.state !== 'rising') { if (self.state === 'rising') requestAnimationFrame(tick); return; }
        var p = Math.min((Date.now() - startTime) / duration, 1.0), e = 1 - Math.pow(1 - p, 3);
        self.height = -1.0 + e; self._syncPivot();
        if (p < 1) requestAnimationFrame(tick);
        else { self.state = 'normal'; self.height = 0; self.mesh.material = getDiceMaterials(self.faces, 'normal'); self._syncPivot(); checkAllMatches(); }
    }
    requestAnimationFrame(tick);
};
Die.prototype.roll = function(direction, onComplete) {
    if (this.state !== 'normal' && this.state !== 'locked') return; if (this.cellType === CELL_TYPE.LOCKED) return;
    this.state = 'rolling'; var sx = this.gridX, sy = this.gridY, d = DIRECTIONS[direction], ex = sx + d.dx, ey = sy + d.dy;
    if (ex < 0 || ex >= GRID_COLS || ey < 0 || ey >= GRID_ROWS) { this.state = 'normal'; if (onComplete) onComplete(); return; }
    if (grid[ex][ey] !== null) { this.state = 'normal'; AudioEngine.playMove(); if (onComplete) onComplete(); return; }
    grid[sx][sy] = null; grid[ex][ey] = this; this.gridX = ex; this.gridY = ey;
    var old = Object.assign({}, this.faces), axis = new THREE.Vector3();
    if (direction === 'east') { this.faces.top = old.left; this.faces.right = old.top; this.faces.bottom = old.right; this.faces.left = old.bottom; axis.set(0, 0, -1); }
    else if (direction === 'west') { this.faces.top = old.right; this.faces.left = old.top; this.faces.bottom = old.left; this.faces.right = old.bottom; axis.set(0, 0, 1); }
    else if (direction === 'south') { this.faces.top = old.back; this.faces.front = old.top; this.faces.bottom = old.front; this.faces.back = old.bottom; axis.set(1, 0, 0); }
    else if (direction === 'north') { this.faces.top = old.front; this.faces.back = old.top; this.faces.bottom = old.back; this.faces.front = old.bottom; axis.set(-1, 0, 0); }
    AudioEngine.playRoll();
    var self = this, startTime = Date.now(), sWX = (sx - (GRID_COLS - 1) / 2) * GRID_SPACING, sWZ = (sy - (GRID_ROWS - 1) / 2) * GRID_SPACING;
    var eWX = (ex - (GRID_COLS - 1) / 2) * GRID_SPACING, eWZ = (ey - (GRID_ROWS - 1) / 2) * GRID_SPACING;
    self.mesh.material = getDiceMaterials(self.faces, 'normal');
    function tick() {
        var elapsed = Date.now() - startTime, p = Math.min(elapsed / ROLL_DURATION, 1.0), ease = 1 - Math.pow(1 - p, 3);
        self.pivotGroup.position.set(sWX + ease * (eWX - sWX), Math.sin(p * Math.PI) * 0.18, sWZ + ease * (eWZ - sWZ));
        self.pivotGroup.setRotationFromAxisAngle(axis, ease * (Math.PI / 2));
        if (p < 1) requestAnimationFrame(tick);
        else {
            self.pivotGroup.rotation.set(0, 0, 0); self.pivotGroup.position.set(eWX, 0, eWZ);
            self.state = 'normal'; self.height = 0; self._syncPivot(); if (onComplete) onComplete();
        }
    }
    requestAnimationFrame(tick);
};
Die.prototype.slide = function(direction, onComplete) {
    if (this.state !== 'normal') return; if (this.cellType === CELL_TYPE.LOCKED) return;
    var d = DIRECTIONS[direction], tx = this.gridX + d.dx, ty = this.gridY + d.dy;
    if (tx < 0 || tx >= GRID_COLS || ty < 0 || ty >= GRID_ROWS) { if (onComplete) onComplete(); return; }
    if (grid[tx][ty] !== null) { AudioEngine.playMove(); if (onComplete) onComplete(); return; }
    this._execSlide(direction, onComplete);
};
Die.prototype._execSlide = function(direction, onComplete) {
    this.state = 'sliding'; var sx = this.gridX, sy = this.gridY, d = DIRECTIONS[direction], ex = sx + d.dx, ey = sy + d.dy;
    grid[sx][sy] = null; grid[ex][ey] = this; this.gridX = ex; this.gridY = ey; AudioEngine.playSlide();
    var self = this, startTime = Date.now(), sWX = (sx - (GRID_COLS - 1) / 2) * GRID_SPACING, sWZ = (sy - (GRID_ROWS - 1) / 2) * GRID_SPACING;
    var eWX = (ex - (GRID_COLS - 1) / 2) * GRID_SPACING, eWZ = (ey - (GRID_ROWS - 1) / 2) * GRID_SPACING;
    function tick() { var p = Math.min((Date.now() - startTime) / SLIDE_DURATION, 1.0), ease = 1 - Math.pow(1 - p, 2); self.pivotGroup.position.set(sWX + ease * (eWX - sWX), 0, sWZ + ease * (eWZ - sWZ)); if (p < 1) requestAnimationFrame(tick); else { self.state = 'normal'; self.height = 0; self._syncPivot(); if (onComplete) onComplete(); } }
    requestAnimationFrame(tick);
};
Die.prototype.startSinking = function(groupId) { if (this.state === 'sinking') return; this.state = 'sinking'; this.sinkingGroup = groupId; this.sinkingTimer = Date.now(); var isOne = (this.faces.top === 1); this.mesh.material = getDiceMaterials(this.faces, isOne ? 'sinking_one' : 'sinking'); };
Die.prototype.updateSinking = function() { if (this.state !== 'sinking') return false; var p = Math.min((Date.now() - this.sinkingTimer) / SINK_DURATION, 1.0); this.height = -p; this._syncPivot(); this.mesh.material.forEach(function(m) { if (m.transparent) m.opacity = 1 - p; }); if (p >= 1) { diceGroup.remove(this.pivotGroup); this.mesh.geometry.dispose(); if (grid[this.gridX] && grid[this.gridX][this.gridY] === this) grid[this.gridX][this.gridY] = null; return true; } return false; };

function initEngine() {
    var container = document.getElementById('game-container'); container.innerHTML = '';
    scene = new THREE.Scene(); scene.background = new THREE.Color(PALETTE.boardFloor); scene.fog = new THREE.FogExp2(PALETTE.boardFloor, 0.02);
    worldGroup = new THREE.Group(); boardGroup = new THREE.Group(); diceGroup = new THREE.Group();
    worldGroup.add(boardGroup); worldGroup.add(diceGroup); scene.add(worldGroup);
    renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    setupOrthoCamera();
    var al = new THREE.AmbientLight(0xffffff, 0.45); scene.add(al);
    var dl = new THREE.DirectionalLight(0xffeedd, 0.85); dl.position.set(8, 14, 5); dl.castShadow = true;
    dl.shadow.mapSize.width = 1024; dl.shadow.mapSize.height = 1024; dl.shadow.camera.near = 0.5; dl.shadow.camera.far = 50;
    var dd = 10; dl.shadow.camera.left = -dd; dl.shadow.camera.right = dd; dl.shadow.camera.top = dd; dl.shadow.camera.bottom = -dd; scene.add(dl);
    var pl = new THREE.PointLight(0xff3366, 0.45, 25); pl.position.set(-4, 3, -4); scene.add(pl);
    buildBoard(); window.addEventListener('resize', onWindowResize, false);
}

function setupOrthoCamera() {
    var boardHalf = Math.max(GRID_COLS, GRID_ROWS) * GRID_SPACING / 2 + GRID_SPACING * 0.7;
    var aspect = window.innerWidth / window.innerHeight;
    var halfH = boardHalf, halfV = boardHalf;
    if (aspect < 1) halfV = boardHalf / aspect;
    else halfH = boardHalf * aspect;
    camera = new THREE.OrthographicCamera(-halfH, halfH, halfV, -halfV, 0.1, 50);
    var dist = Math.max(halfH, halfV) * 1.5, h = dist * 0.65;
    camera.position.set(dist * 0.45, h, dist * 0.6); camera.lookAt(0, -0.3, 0); camera.updateProjectionMatrix();
}
function onWindowResize() {
    var boardHalf = Math.max(GRID_COLS, GRID_ROWS) * GRID_SPACING / 2 + GRID_SPACING * 0.7;
    var aspect = window.innerWidth / window.innerHeight;
    var halfH = boardHalf, halfV = boardHalf;
    if (aspect < 1) halfV = boardHalf / aspect;
    else halfH = boardHalf * aspect;
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.left = -halfH; camera.right = halfH; camera.top = halfV; camera.bottom = -halfV; camera.updateProjectionMatrix();
}


function buildBoard() {
    boardGroup.clear(); var bw = GRID_COLS * GRID_SPACING, bh = GRID_ROWS * GRID_SPACING;
    var bezelGeom = new THREE.BoxGeometry(bw + 0.4, 0.4, bh + 0.4), bezelMat = new THREE.MeshLambertMaterial({ color: 0x221a30 });
    var bezel = new THREE.Mesh(bezelGeom, bezelMat); bezel.position.y = -0.2; bezel.receiveShadow = true; boardGroup.add(bezel);
    sinkingHighlights = Array(GRID_COLS).fill(null).map(function() { return Array(GRID_ROWS).fill(null); });
    var hlGeom = new THREE.PlaneGeometry(GRID_SPACING - 0.12, GRID_SPACING - 0.12);
    var hlMat = new THREE.MeshBasicMaterial({ color: 0xff3366, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthTest: false });
    for (var x = 0; x < GRID_COLS; x++) for (var y = 0; y < GRID_ROWS; y++) {
        var tileGeom = new THREE.BoxGeometry(GRID_SPACING - 0.08, 0.1, GRID_SPACING - 0.08), isDark = (x + y) % 2 === 0;
        var tileMat = new THREE.MeshLambertMaterial({ color: isDark ? 0x161026 : 0x1c1430, emissive: PALETTE.boardGrid, emissiveIntensity: 0.12 });
        var tile = new THREE.Mesh(tileGeom, tileMat); tile.position.set((x - (GRID_COLS - 1) / 2) * GRID_SPACING, -0.05, (y - (GRID_ROWS - 1) / 2) * GRID_SPACING);
        tile.receiveShadow = true; boardGroup.add(tile);
        var hl = new THREE.Mesh(hlGeom, hlMat);
        hl.rotation.x = -Math.PI / 2;
        hl.position.set((x - (GRID_COLS - 1) / 2) * GRID_SPACING, 0.01, (y - (GRID_ROWS - 1) / 2) * GRID_SPACING);
        hl.visible = false; boardGroup.add(hl);
        sinkingHighlights[x][y] = hl;
    }
}

function setBoardSize(sizeKey) { if (!BOARD_PRESETS[sizeKey]) return; var preset = BOARD_PRESETS[sizeKey]; boardSize = sizeKey; GRID_COLS = preset.cols; GRID_ROWS = preset.rows; totalCells = GRID_COLS * GRID_ROWS; grid = Array(GRID_COLS).fill(null).map(function() { return Array(GRID_ROWS).fill(null); }); buildBoard(); setupOrthoCamera(); }

function battleAwardScore(points) {
    if (gameMode !== 'battle') { score += points; updateScoreDisplay(); return; }
    if (battleCurrentTurn === 'player') battlePlayerScore += points;
    else if (battleCurrentTurn === 'ai') battleAiScore += points;
    updateBattleHUD();
}
function battleFreezeOpponent(comboN, diceVal) {
    if (gameMode !== 'battle' || !battleCurrentTurn) return;
    var ms = Math.min(comboN * diceVal * 500, 10000);
    if (battleCurrentTurn === 'player') battleAiFrozenUntil = Date.now() + ms;
    else battlePlayerFrozenUntil = Date.now() + ms;
    updateBattleHUD();
}

function checkAllMatches() {
    var visited = Array(GRID_COLS).fill(false).map(function() { return Array(GRID_ROWS).fill(false); }), matchedAny = false;
    for (var x = 0; x < GRID_COLS; x++) for (var y = 0; y < GRID_ROWS; y++) {
        var die = grid[x][y]; if (!die || die.state !== 'normal' || visited[x][y]) continue; if (die.cellType === CELL_TYPE.LOCKED) continue;
        var targetVal = die.faces.top; if (targetVal === 1) continue;
        var component = [], queue = [[x, y]]; visited[x][y] = true;
        while (queue.length > 0) { var cell = queue.shift(), cx = cell[0], cy = cell[1]; component.push(grid[cx][cy]);
            var neighbors = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
            for (var ni = 0; ni < neighbors.length; ni++) { var nx = neighbors[ni][0], ny = neighbors[ni][1];
                if (nx >= 0 && nx < GRID_COLS && ny >= 0 && ny < GRID_ROWS) { var nd = grid[nx][ny];
                    if (nd && nd.state === 'normal' && nd.cellType === CELL_TYPE.ACTIVE && !visited[nx][ny] && nd.faces.top === targetVal) { visited[nx][ny] = true; queue.push([nx, ny]); } } } }
        if (component.length >= targetVal) { matchedAny = true; var groupId = Date.now() + Math.random().toString(36).substr(2, 5);
            component.forEach(function(d) { d.startSinking(groupId); });
            activeSinkingGroups.push({ id: groupId, diceValue: targetVal, diceList: component, lastActivity: Date.now() });
            var points = targetVal * component.length * 100; battleAwardScore(points); AudioEngine.playMatch();
            createFloatingScore(component[0].gridX, component[0].gridY, '+' + points); triggerChainEvaluations(groupId, targetVal); } }
    checkOnesChaining();
}

function evaluateRollChain(rolledDie) { if (rolledDie.state !== 'normal') return; var rx = rolledDie.gridX, ry = rolledDie.gridY, rv = rolledDie.faces.top; var neighbors = [[rx + 1, ry], [rx - 1, ry], [rx, ry + 1], [rx, ry - 1]]; for (var ni = 0; ni < neighbors.length; ni++) { var nx = neighbors[ni][0], ny = neighbors[ni][1]; if (nx >= 0 && nx < GRID_COLS && ny >= 0 && ny < GRID_ROWS) { var nd = grid[nx][ny]; if (nd && nd.state === 'sinking') { var group = activeSinkingGroups.find(function(g) { return g.id === nd.sinkingGroup; }); if (group) { if (rv === group.diceValue && rv !== 1) { addDieToSinkingGroup(rolledDie, group); return; } else if (rv === 1) { addDieToSinkingGroup(rolledDie, group); return; } } } } } }

function addDieToSinkingGroup(die, group) { die.startSinking(group.id); group.diceList.push(die); group.lastActivity = Date.now(); group.diceList.forEach(function(d) { d.sinkingTimer = Date.now(); }); comboCount++; showComboBanner(); var comboPoints = comboCount * 250; battleAwardScore(comboPoints); battleFreezeOpponent(comboCount, group.diceValue); AudioEngine.playCombo(comboCount); createFloatingScore(die.gridX, die.gridY, 'COMBO +' + comboPoints); checkOnesChaining(); }

function checkOnesChaining() { var chainedAny = false; for (var x = 0; x < GRID_COLS; x++) for (var y = 0; y < GRID_ROWS; y++) { var die = grid[x][y]; if (die && die.state === 'normal' && die.cellType === CELL_TYPE.ACTIVE && die.faces.top === 1) { var neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]; for (var ni = 0; ni < neighbors.length; ni++) { var nx = neighbors[ni][0], ny = neighbors[ni][1]; if (nx >= 0 && nx < GRID_COLS && ny >= 0 && ny < GRID_ROWS) { var nd = grid[nx][ny]; if (nd && nd.state === 'sinking') { var group = activeSinkingGroups.find(function(g) { return g.id === nd.sinkingGroup; }); if (group) { addDieToSinkingGroup(die, group); chainedAny = true; break; } } } } } } if (chainedAny) checkOnesChaining(); }

function triggerChainEvaluations(groupId, diceValue) { var group = activeSinkingGroups.find(function(g) { return g.id === groupId; }); if (!group) return; var searchAgain = true; while (searchAgain) { searchAgain = false; for (var gi = 0; gi < group.diceList.length; gi++) { var gd = group.diceList[gi]; var neighbors = [[gd.gridX + 1, gd.gridY], [gd.gridX - 1, gd.gridY], [gd.gridX, gd.gridY + 1], [gd.gridX, gd.gridY - 1]]; for (var ni = 0; ni < neighbors.length; ni++) { var nx = neighbors[ni][0], ny = neighbors[ni][1]; if (nx >= 0 && nx < GRID_COLS && ny >= 0 && ny < GRID_ROWS) { var candidate = grid[nx][ny]; if (candidate && candidate.state === 'normal' && candidate.cellType === CELL_TYPE.ACTIVE && (candidate.faces.top === diceValue || candidate.faces.top === 1)) { candidate.startSinking(groupId); group.diceList.push(candidate); searchAgain = true; var pts = diceValue * 100; battleAwardScore(pts); createFloatingScore(nx, ny, '+' + pts); } } } if (searchAgain) break; } } }

function updateSinkingDice() { for (var i = activeSinkingGroups.length - 1; i >= 0; i--) { var group = activeSinkingGroups[i], allSunk = true; group.diceList.forEach(function(d) { if (!d.updateSinking()) allSunk = false; }); if (allSunk) activeSinkingGroups.splice(i, 1); } }

function spawnRandomDie() { if (gameState !== 'playing') return; var emptySlots = []; for (var x = 0; x < GRID_COLS; x++) for (var y = 0; y < GRID_ROWS; y++) if (grid[x][y] === null) emptySlots.push({ x: x, y: y }); var activeCount = countActiveDice(), fullness = activeCount / totalCells; updateFullnessBar(fullness); if (emptySlots.length === 0) { triggerGameOver(); return; } var slot = emptySlots[Math.floor(Math.random() * emptySlots.length)], nd = new Die(slot.x, slot.y); grid[slot.x][slot.y] = nd; var baseInterval = DIFFICULTY_SETTINGS[selectedDifficulty].spawnInterval, speedup = Math.max(0.55, 1 - (score / 150000)); spawnTimerId = setTimeout(spawnRandomDie, baseInterval * speedup); }
function stopSpawning() { if (spawnTimerId) { clearTimeout(spawnTimerId); spawnTimerId = null; } }
function countActiveDice() { var count = 0; for (var x = 0; x < GRID_COLS; x++) for (var y = 0; y < GRID_ROWS; y++) if (grid[x][y] !== null) count++; return count; }

function populateInitialBoard() { for (var x = 0; x < GRID_COLS; x++) for (var y = 0; y < GRID_ROWS; y++) if (grid[x] && grid[x][y]) { diceGroup.remove(grid[x][y].pivotGroup); grid[x][y].mesh.geometry.dispose(); } grid = Array(GRID_COLS).fill(null).map(function() { return Array(GRID_ROWS).fill(null); }); activeSinkingGroups = []; var numDice = Math.round(DIFFICULTY_SETTINGS[selectedDifficulty].diceRatio * totalCells), placed = 0; while (placed < numDice) { var rx = Math.floor(Math.random() * GRID_COLS), ry = Math.floor(Math.random() * GRID_ROWS); if (grid[rx][ry] !== null) continue; var d = new Die(rx, ry); d.state = 'normal'; d.height = 0; d.mesh.material = getDiceMaterials(d.faces, 'normal'); d.updateMeshPosition(); grid[rx][ry] = d; placed++; } checkAllMatches(); }

function createFloatingScore(gx, gy, txt) { var wx = (gx - (GRID_COLS - 1) / 2) * GRID_SPACING, wz = (gy - (GRID_ROWS - 1) / 2) * GRID_SPACING, pos3D = new THREE.Vector3(wx, 0.8, wz); var el = document.createElement('div'); el.className = 'floating-score'; el.innerText = txt; document.getElementById('ui-container').appendChild(el); var startTime = Date.now(), duration = 1200; function animateFloat() { var elapsed = Date.now() - startTime, progress = elapsed / duration; if (progress >= 1.0 || gameState === 'menu') { if (el.parentNode) el.parentNode.removeChild(el); return; } var curPos = pos3D.clone(); curPos.y += progress * 1.5; curPos.project(camera); el.style.left = ((curPos.x * 0.5 + 0.5) * window.innerWidth) + 'px'; el.style.top = ((-(curPos.y * 0.5) + 0.5) * window.innerHeight) + 'px'; el.style.opacity = 1 - progress; el.style.transform = 'translate(-50%, -50%) scale(' + (1 + progress * 0.3) + ')'; requestAnimationFrame(animateFloat); } requestAnimationFrame(animateFloat); }

var inputState = { activePtrId: null, sX: 0, sY: 0, sT: 0, curDie: null, holdTmr: null, isHolding: false, hasMoved: false, lastGX: -1, lastGY: -1 };
function setupPointerEvents() { var cv = renderer.domElement; cv.addEventListener('pointerdown', onPointerDown); cv.addEventListener('pointermove', onPointerMove); cv.addEventListener('pointerup', onPointerUp); cv.addEventListener('pointercancel', onPointerUp); cv.addEventListener('contextmenu', function(e) { e.preventDefault(); }); }
function onPointerDown(e) { if (gameState !== 'playing' || animationLock || inputState.activePtrId !== null) return; if (gameMode === 'battle' && Date.now() < battlePlayerFrozenUntil) return; e.preventDefault(); inputState.activePtrId = e.pointerId; inputState.sX = e.clientX; inputState.sY = e.clientY; inputState.sT = Date.now(); inputState.isHolding = false; inputState.hasMoved = false; inputState.curDie = null; inputState.lastGX = -1; inputState.lastGY = -1; var die = raycastDie(e.clientX, e.clientY); if (die && die.state === 'normal' && die.cellType === CELL_TYPE.ACTIVE) { inputState.curDie = die; die.setHover(true); inputState.lastGX = die.gridX; inputState.lastGY = die.gridY; } if (inputState.holdTmr) clearTimeout(inputState.holdTmr); inputState.holdTmr = setTimeout(function() { if (inputState.activePtrId !== null && inputState.curDie && !inputState.hasMoved) { inputState.isHolding = true; AudioEngine.playHaptic(); showGestureHint('Hold & Drag'); } }, HOLD_THRESHOLD); }
function onPointerMove(e) { if (gameState !== 'playing' || inputState.activePtrId !== e.pointerId) return; if (gameMode === 'battle' && Date.now() < battlePlayerFrozenUntil) return; var dx = e.clientX - inputState.sX, dy = e.clientY - inputState.sY, dist = Math.sqrt(dx * dx + dy * dy); if (dist < SWIPE_THRESHOLD && !inputState.isHolding) return; if (inputState.isHolding && inputState.curDie) { e.preventDefault(); inputState.hasMoved = true; var cell = getGridCellFromPointer(e.clientX, e.clientY); if (cell && (cell.gx !== inputState.lastGX || cell.gy !== inputState.lastGY)) { var gdx = cell.gx - inputState.lastGX, gdy = cell.gy - inputState.lastGY; var dir = null; if (gdx === 1 && gdy === 0) dir = 'east'; else if (gdx === -1 && gdy === 0) dir = 'west'; else if (gdx === 0 && gdy === 1) dir = 'south'; else if (gdx === 0 && gdy === -1) dir = 'north'; if (dir) { triggerSlide(inputState.curDie, dir); inputState.lastGX = cell.gx; inputState.lastGY = cell.gy; } } } else if (dist >= SWIPE_THRESHOLD) { if (inputState.holdTmr) { clearTimeout(inputState.holdTmr); inputState.holdTmr = null; } inputState.hasMoved = true; } }
function onPointerUp(e) { if (inputState.activePtrId !== e.pointerId) return; if (inputState.holdTmr) { clearTimeout(inputState.holdTmr); inputState.holdTmr = null; } var dx = e.clientX - inputState.sX, dy = e.clientY - inputState.sY, dist = Math.sqrt(dx * dx + dy * dy), elapsed = Date.now() - inputState.sT; if (inputState.curDie) inputState.curDie.setHover(false); if (!inputState.isHolding && inputState.hasMoved && dist >= SWIPE_THRESHOLD && elapsed < HOLD_THRESHOLD) { if (gameMode !== 'battle' || Date.now() >= battlePlayerFrozenUntil) { var dir = getSwipeDirection(dx, dy); if (inputState.curDie && inputState.curDie.state === 'normal') triggerRoll(inputState.curDie, dir); } } hideGestureHint(); inputState.activePtrId = null; inputState.curDie = null; inputState.isHolding = false; inputState.hasMoved = false; }
function raycastDie(cx, cy) { var rect = renderer.domElement.getBoundingClientRect(), mx = ((cx - rect.left) / rect.width) * 2 - 1, my = -((cy - rect.top) / rect.height) * 2 + 1; var rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(mx, my), camera); var hits = rc.intersectObjects(diceGroup.children, true); if (hits.length > 0) { var obj = hits[0].object; while (obj && !obj.userData.die) obj = obj.parent; if (obj && obj.userData.die) return obj.userData.die; } return null; }
function getSwipeDirection(dx, dy) { var ang = Math.atan2(dy, dx), deg = ang * (180 / Math.PI); if (deg < 0) deg += 360; if (deg >= 0 && deg < 90) return "east"; if (deg >= 90 && deg < 180) return "south"; if (deg >= 180 && deg < 270) return "west"; return "north"; }
function getGridCellFromPointer(cx, cy) { var rect = renderer.domElement.getBoundingClientRect(), mx = ((cx - rect.left) / rect.width) * 2 - 1, my = -((cy - rect.top) / rect.height) * 2 + 1; var rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(mx, my), camera); var plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); var pt = new THREE.Vector3(); if (rc.ray.intersectPlane(plane, pt)) { var gx = Math.round(pt.x / GRID_SPACING + (GRID_COLS - 1) / 2), gy = Math.round(pt.z / GRID_SPACING + (GRID_ROWS - 1) / 2); if (gx >= 0 && gx < GRID_COLS && gy >= 0 && gy < GRID_ROWS) return { gx: gx, gy: gy }; } return null; }
function triggerRoll(die, dir) { animationLock = true; var turn = gameMode === 'battle' ? 'player' : null; battleCurrentTurn = turn; die.roll(dir, function() { battleCurrentTurn = turn; evaluateRollChain(die); checkAllMatches(); animationLock = false; if (gameMode === 'puzzle') decrementPuzzleMove(); }); }
function triggerSlide(die, dir) { animationLock = true; var turn = gameMode === 'battle' ? 'player' : null; battleCurrentTurn = turn; die.slide(dir, function() { battleCurrentTurn = turn; evaluateRollChain(die); checkAllMatches(); animationLock = false; if (gameMode === 'puzzle') decrementPuzzleMove(); }); }
function handleKeyboard(e) { if (gameState !== 'playing') return; if (gameMode === 'battle' && Date.now() < battlePlayerFrozenUntil) return; var k = e.key.toLowerCase(); if (k === 'p' || k === 'escape') { pauseGame(); return; } var dir = null; if (k === 'arrowup' || k === 'w') dir = 'north'; else if (k === 'arrowdown' || k === 's') dir = 'south'; else if (k === 'arrowleft' || k === 'a') dir = 'west'; else if (k === 'arrowright' || k === 'd') dir = 'east'; else return; var die = findRollableDie(); if (die) triggerRoll(die, dir); }
function findRollableDie() { var cx = Math.floor(GRID_COLS / 2), cy = Math.floor(GRID_ROWS / 2); for (var r = 0; r < Math.max(GRID_COLS, GRID_ROWS); r++) for (var dx = -r; dx <= r; dx++) for (var dy = -r; dy <= r; dy++) { if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; var x = cx + dx, y = cy + dy; if (x >= 0 && x < GRID_COLS && y >= 0 && y < GRID_ROWS) { var die = grid[x][y]; if (die && die.state === 'normal' && die.cellType === CELL_TYPE.ACTIVE) return die; } } return null; }
function showGestureHint(txt) { var h = document.getElementById('gesture-hint'); document.getElementById('hint-text').innerText = txt; h.classList.remove('gesture-hide'); }
function hideGestureHint() { document.getElementById('gesture-hint').classList.add('gesture-hide'); }

function startGame(mode) { mode = mode || 'zen'; AudioEngine.init(); gameState = 'playing'; gameMode = mode; score = 0; comboCount = 0; animationLock = false; updateScoreDisplay(); hideComboBanner(); hideGestureHint(); document.getElementById('menu-screen').classList.remove('active'); document.getElementById('pause-screen').classList.remove('active'); document.getElementById('gameover-screen').classList.remove('active'); document.getElementById('hud-screen').classList.add('active'); document.getElementById('puzzle-hud').style.display = (mode === 'puzzle') ? 'flex' : 'none'; document.getElementById('battle-hud').style.display = (mode === 'battle') ? 'flex' : 'none'; document.getElementById('hud-screen').classList.toggle('hide-highscore', mode === 'battle'); document.getElementById('battle-timer-box').style.display = (mode === 'battle') ? 'block' : 'none'; if (mode === 'puzzle') setupPuzzleMode(); else if (mode === 'battle') setupBattleMode(); else { populateInitialBoard(); startSpawning(); } if (musicEnabled) { AudioEngine.stopBGM(); AudioEngine.startBGM(); } updateFullnessBar(countActiveDice() / totalCells); }
function startSpawning() { stopSpawning(); spawnTimerId = setTimeout(spawnRandomDie, DIFFICULTY_SETTINGS[selectedDifficulty].spawnInterval); }
function pauseGame() { if (gameState !== 'playing') return; gameState = 'paused'; stopSpawning(); AudioEngine.stopBGM(); document.getElementById('hud-screen').classList.remove('active'); document.getElementById('pause-screen').classList.add('active'); }
function resumeGame() { if (gameState !== 'paused') return; gameState = 'playing'; document.getElementById('pause-screen').classList.remove('active'); document.getElementById('hud-screen').classList.add('active'); if (gameMode !== 'puzzle') startSpawning(); if (musicEnabled) AudioEngine.startBGM(); }
function quitToMenu() { gameState = 'menu'; stopSpawning(); AudioEngine.stopBGM(); if (gameMode === 'battle') { stopAITicks(); stopBattleTimer(); } document.getElementById('pause-screen').classList.remove('active'); document.getElementById('gameover-screen').classList.remove('active'); document.getElementById('hud-screen').classList.remove('active'); document.getElementById('hud-screen').classList.remove('hide-highscore'); document.getElementById('battle-timer-box').style.display = 'none'; document.getElementById('menu-screen').classList.add('active'); document.getElementById('menu-highscore').innerText = Number(highScore).toLocaleString(); clearAllDice(); }
function clearAllDice() { for (var x = 0; x < GRID_COLS; x++) for (var y = 0; y < GRID_ROWS; y++) { if (grid[x] && grid[x][y]) { diceGroup.remove(grid[x][y].pivotGroup); grid[x][y].mesh.geometry.dispose(); } if (sinkingHighlights[x] && sinkingHighlights[x][y]) sinkingHighlights[x][y].visible = false; } grid = Array(GRID_COLS).fill(null).map(function() { return Array(GRID_ROWS).fill(null); }); activeSinkingGroups = []; }
function triggerGameOver() { gameState = 'gameover'; stopSpawning(); AudioEngine.stopBGM(); var isBattle = gameMode === 'battle', playerWon = battlePlayerScore >= battleAiScore; if (isBattle && playerWon) AudioEngine.playWin(); else AudioEngine.playGameOver(); if (gameMode === 'battle') { stopAITicks(); stopBattleTimer(); } var isNewHigh = false; if (gameMode !== 'battle' && score > highScore) { highScore = score; localStorage.setItem('devildice_zen_hs', highScore); isNewHigh = true; } document.getElementById('go-score').innerText = (gameMode === 'battle' ? battlePlayerScore : score).toLocaleString(); document.getElementById('go-combo').innerText = comboCount.toString(); document.getElementById('new-high-indicator').style.display = isNewHigh ? 'block' : 'none'; var titleEl = document.getElementById('gameover-title-text'); if (gameMode === 'puzzle') titleEl.innerText = puzzleCleared ? 'ALL PUZZLES CLEARED!' : 'OUT OF MOVES!'; else if (isBattle) titleEl.innerText = playerWon ? 'YOU WIN!' : 'YOU LOSE!'; else titleEl.innerText = 'BOARD FILLED!'; document.getElementById('battle-go-stats').style.display = isBattle ? '' : 'none'; if (isBattle) { document.getElementById('go-player-score').innerText = battlePlayerScore.toLocaleString(); document.getElementById('go-ai-score').innerText = battleAiScore.toLocaleString(); var pr = document.getElementById('go-player-row'), ar = document.getElementById('go-ai-row'); if (playerWon) { pr.classList.add('winner'); ar.classList.remove('winner'); } else { ar.classList.add('winner'); pr.classList.remove('winner'); } } else { document.getElementById('go-player-row').classList.remove('winner'); document.getElementById('go-ai-row').classList.remove('winner'); } document.getElementById('hud-screen').classList.remove('active'); document.getElementById('gameover-screen').classList.add('active'); document.getElementById('battle-timer-box').style.display = 'none'; }

function setupPuzzleMode() { puzzleStage = 1; setupPuzzleStage(); }
function setupPuzzleStage() {
    clearAllDice(); puzzleCleared = false;
    var stage = puzzleStage;
    var moveBase = 5, movePerStage = 3;
    puzzleMovesRemaining = moveBase + stage * movePerStage + Math.floor(Math.random() * 4);
    document.getElementById('hud-moves').innerText = String(puzzleMovesRemaining).padStart(2, '0');
    document.getElementById('puzzle-stage').innerText = 'STAGE ' + stage + '/' + puzzleMaxStages;
    var layout = generatePuzzleLayout(stage);
    layout.forEach(function(item) {
        if (item.x >= 0 && item.x < GRID_COLS && item.y >= 0 && item.y < GRID_ROWS && !grid[item.x][item.y]) {
            var d = new Die(item.x, item.y, item.v);
            d.state = 'normal'; d.height = 0;
            d.mesh.material = getDiceMaterials(d.faces, 'normal');
            d.updateMeshPosition();
            grid[item.x][item.y] = d;
        }
    });
    updateFullnessBar(countActiveDice() / totalCells);
}
function generatePuzzleLayout(stage) {
    var dice = [], placed = {};
    var cols = GRID_COLS, rows = GRID_ROWS;
    var minX = 1, maxX = cols - 2, minY = 1, maxY = rows - 2;
    function add(x, y, v) { var k = x + ',' + y; if (!placed[k] && x >= minX && x <= maxX && y >= minY && y <= maxY) { placed[k] = true; dice.push({ x: x, y: y, v: v }); } }
    function randInt(n) { return Math.floor(Math.random() * n); }
    var numGroups = 2 + Math.floor(stage / 2);
    var groupSize = 3 + Math.floor(stage / 3);
    var targetVals = stage <= 3 ? [3, 4] : stage <= 6 ? [3, 4, 5] : [4, 5, 6];
    var extraOnes = stage <= 4 ? 1 : stage <= 7 ? 2 : 3;
    for (var g = 0; g < numGroups; g++) {
        var val = targetVals[randInt(targetVals.length)];
        var sx = minX + randInt(maxX - minX - groupSize + 1);
        var sy = minY + randInt(maxY - minY - groupSize + 1);
        var pattern = randInt(5);
        if (pattern === 0) {
            for (var i = 0; i < groupSize; i++) add(sx + i, sy, val);
            if (randInt(3) === 0 && sy < maxY) add(sx + randInt(groupSize), sy + 1, val);
        } else if (pattern === 1) {
            for (var i = 0; i < groupSize; i++) add(sx, sy + i, val);
            if (randInt(3) === 0 && sx < maxX) add(sx + 1, sy + randInt(groupSize), val);
        } else if (pattern === 2) {
            var mid = Math.floor(groupSize / 2);
            for (var i = 0; i < groupSize; i++) add(sx + i, sy + mid, val);
            if (mid > 0 && sy + mid - 1 >= minY) add(sx + mid, sy + mid - 1, val);
            if (sy + mid + 1 <= maxY) add(sx + mid, sy + mid + 1, val);
        } else if (pattern === 3) {
            for (var i = 0; i < groupSize; i++) {
                add(sx + i, sy, val);
                if (sy + 1 <= maxY && randInt(2) === 0) add(sx + i, sy + 1, val);
            }
        } else {
            for (var i = 0; i < groupSize; i++) {
                add(sx + (i % 2), sy + Math.floor(i / 2), val);
            }
            if (groupSize > 3 && randInt(2) === 0) add(sx + 2, sy + Math.floor(groupSize / 2), val);
        }
    }
    for (var o = 0; o < extraOnes; o++) {
        for (var attempts = 0; attempts < 20; attempts++) {
            var ox = minX + randInt(maxX - minX + 1);
            var oy = minY + randInt(maxY - minY + 1);
            if (add(ox, oy, 1)) break;
        }
    }
    return dice;
}
function decrementPuzzleMove() {
    puzzleMovesRemaining--;
    document.getElementById('hud-moves').innerText = String(Math.max(0, puzzleMovesRemaining)).padStart(2, '0');
    if (countPuzzleRemaining() === 0) {
        puzzleCleared = true;
        score += puzzleMovesRemaining * 500 + puzzleStage * 1000;
        updateScoreDisplay();
        if (puzzleStage >= puzzleMaxStages) {
            triggerGameOver();
        } else {
            puzzleStage++;
            showStageClearBanner();
            setTimeout(function() { hideStageClearBanner(); setupPuzzleStage(); }, 1800);
        }
        return;
    }
    if (puzzleMovesRemaining <= 0) triggerGameOver();
}
function countPuzzleRemaining() { var c = 0; for (var x = 0; x < GRID_COLS; x++) for (var y = 0; y < GRID_ROWS; y++) { var d = grid[x] && grid[x][y]; if (d && d.state !== 'sinking' && d.cellType !== CELL_TYPE.LOCKED) c++; } return c; }
function showStageClearBanner() {
    var b = document.getElementById('stage-clear-banner');
    document.getElementById('stage-clear-text').innerText = 'STAGE ' + (puzzleStage - 1) + ' CLEAR!';
    b.classList.remove('stage-clear-hide');
    b.classList.add('active');
}
function hideStageClearBanner() {
    var b = document.getElementById('stage-clear-banner');
    b.classList.remove('active');
    b.classList.add('stage-clear-hide');
}


function setupBattleMode() { clearAllDice(); battlePlayerScore = 0; battleAiScore = 0; battleTimeRemaining = battleDuration; battleCurrentTurn = null; battlePlayerFrozenUntil = 0; battleAiFrozenUntil = 0; comboCount = 0; if (battleTimerId) { clearInterval(battleTimerId); battleTimerId = null; } battleTimerId = setInterval(function() { if (gameState !== 'playing' || gameMode !== 'battle') return; battleTimeRemaining--; updateBattleHUD(); if (battleTimeRemaining <= 0) triggerGameOver(); }, 1000); populateInitialBoard(); startSpawning(); startAITicks(); updateBattleHUD(); }
function stopAITicks() { if (aiTickInterval) { clearInterval(aiTickInterval); aiTickInterval = null; } }
function stopBattleTimer() { if (battleTimerId) { clearInterval(battleTimerId); battleTimerId = null; } }
function startAITicks() { stopAITicks(); var rates = { easy: 1200, medium: 800, hard: 500 }, interval = rates[aiDifficulty] || 800; aiTickInterval = setInterval(function() { if (gameState !== 'playing' || gameMode !== 'battle') return; if (Date.now() < battleAiFrozenUntil) return; var bestMove = aiFindBestMove(); if (bestMove) { var turn = 'ai'; battleCurrentTurn = turn; if (bestMove.isRoll) bestMove.die.roll(bestMove.direction, function() {}); else bestMove.die.slide(bestMove.direction, function() {}); setTimeout(function() { if (gameState === 'playing' && gameMode === 'battle') { battleCurrentTurn = turn; checkAllMatches(); } }, ROLL_DURATION + 50); } }, interval); }
function aiFindBestMove() { var bestScore = -Infinity, bestMove = null; for (var x = 0; x < GRID_COLS; x++) for (var y = 0; y < GRID_ROWS; y++) { var die = grid[x][y]; if (!die || die.state !== 'normal' || die.cellType !== CELL_TYPE.ACTIVE) continue; var directions = ['north', 'south', 'east', 'west']; for (var di = 0; di < directions.length; di++) { var dir = directions[di], d = DIRECTIONS[dir], nx = x + d.dx, ny = y + d.dy; if (nx < 0 || nx >= GRID_COLS || ny < 0 || ny >= GRID_ROWS) continue; if (grid[nx][ny] === null) { var s = aiScoreMove(die, dir, true); if (s > bestScore) { bestScore = s; bestMove = { die: die, direction: dir, isRoll: true }; } var s2 = aiScoreMove(die, dir, false); if (s2 > bestScore) { bestScore = s2; bestMove = { die: die, direction: dir, isRoll: false }; } } } } return bestMove; }
function aiScoreMove(die, dir, isRoll) { var s = 0, d = DIRECTIONS[dir], tx = die.gridX + d.dx, ty = die.gridY + d.dy, cv = die.faces.top; for (var dx = -2; dx <= 2; dx++) for (var dy = -2; dy <= 2; dy++) { var sx = tx + dx, sy = ty + dy; if (sx >= 0 && sx < GRID_COLS && sy >= 0 && sy < GRID_ROWS) { var n = grid[sx][sy]; if (n && n.state === 'normal' && n.cellType === CELL_TYPE.ACTIVE) { if (n.faces.top === cv) s += 30; if (n.faces.top === 1) s += 15; } } } if (cv >= 3) s += cv * 10; for (var gi = 0; gi < activeSinkingGroups.length; gi++) { var group = activeSinkingGroups[gi]; for (var gdi = 0; gdi < group.diceList.length; gdi++) { var gd = group.diceList[gdi], dist = Math.abs(gd.gridX - tx) + Math.abs(gd.gridY - ty); if (dist <= 2) s += 20; } } return s + Math.random() * 10; }
function updateBattleHUD() {
    if (gameMode !== 'battle') return;
    var min = Math.floor(battleTimeRemaining / 60), sec = battleTimeRemaining % 60;
    document.getElementById('battle-timer').innerText = min + ':' + String(sec).padStart(2, '0');
    document.getElementById('battle-player-score').innerText = String(battlePlayerScore).padStart(7, '0');
    document.getElementById('battle-ai-score').innerText = String(battleAiScore).padStart(7, '0');
    updateFreezeDisplay();
}
function updateFreezeDisplay() {
    if (gameMode !== 'battle') return;
    var pf = Date.now() < battlePlayerFrozenUntil, af = Date.now() < battleAiFrozenUntil;
    var ps = document.getElementById('battle-player-status'), as = document.getElementById('battle-ai-status');
    if (pf) {
        var rem = ((battlePlayerFrozenUntil - Date.now()) / 1000).toFixed(1);
        ps.innerText = 'FROZEN ' + rem + 's'; ps.classList.add('frozen');
    } else { ps.innerText = 'ACTIVE'; ps.classList.remove('frozen'); }
    if (af) {
        var rem2 = ((battleAiFrozenUntil - Date.now()) / 1000).toFixed(1);
        as.innerText = 'FROZEN ' + rem2 + 's'; as.classList.add('frozen');
    } else { as.innerText = 'ACTIVE'; as.classList.remove('frozen'); }
}

function updateScoreDisplay() { document.getElementById('hud-score').innerText = String(score).padStart(7, '0'); document.getElementById('hud-highscore').innerText = String(highScore).padStart(7, '0'); }
function updateFullnessBar(pct) { var bar = document.getElementById('capacity-bar'), warning = document.getElementById('capacity-warning'); bar.style.width = Math.min(pct * 100, 100) + '%'; if (pct >= 0.8) { warning.classList.add('danger-alarm'); bar.style.boxShadow = '0 0 10px #ff3366'; } else { warning.classList.remove('danger-alarm'); bar.style.boxShadow = 'none'; } }
var comboTmrId = null;
function showComboBanner() { var banner = document.getElementById('combo-display'); document.getElementById('combo-count').innerText = comboCount.toString(); banner.classList.remove('combo-hide'); if (comboTmrId) clearTimeout(comboTmrId); comboTmrId = setTimeout(function() { banner.classList.add('combo-hide'); }, 2500); }
function hideComboBanner() { document.getElementById('combo-display').classList.add('combo-hide'); }

function setupControlListeners() { window.addEventListener('keydown', handleKeyboard); setupPointerEvents(); document.getElementById('zen-btn').addEventListener('click', function() { startGame('zen'); }); document.getElementById('puzzle-btn').addEventListener('click', function() { startGame('puzzle'); }); document.getElementById('battle-btn').addEventListener('click', function() { startGame('battle'); }); document.getElementById('how-to-btn').addEventListener('click', function() { document.getElementById('how-to-modal').classList.add('active'); }); document.getElementById('close-how-to').addEventListener('click', function() { document.getElementById('how-to-modal').classList.remove('active'); }); document.getElementById('settings-btn').addEventListener('click', function() { document.getElementById('board-size').value = boardSize; document.getElementById('sound-toggle').checked = soundEnabled; document.getElementById('music-toggle').checked = musicEnabled; document.getElementById('difficulty').value = selectedDifficulty; document.getElementById('ai-difficulty').value = aiDifficulty; document.getElementById('battle-duration').value = battleDuration; document.getElementById('settings-modal').classList.add('active'); }); document.getElementById('close-settings').addEventListener('click', function() { soundEnabled = document.getElementById('sound-toggle').checked; var mc = document.getElementById('music-toggle').checked; if (mc !== musicEnabled) { musicEnabled = mc; if (gameState === 'playing') { if (musicEnabled) AudioEngine.startBGM(); else AudioEngine.stopBGM(); } } selectedDifficulty = document.getElementById('difficulty').value; aiDifficulty = document.getElementById('ai-difficulty').value; battleDuration = parseInt(document.getElementById('battle-duration').value); var newBoardSize = document.getElementById('board-size').value; if (newBoardSize !== boardSize) { stopSpawning(); clearAllDice(); setBoardSize(newBoardSize); if (gameState === 'playing') startGame(gameMode); else quitToMenu(); } document.getElementById('settings-modal').classList.remove('active'); }); document.getElementById('pause-btn').addEventListener('click', pauseGame); document.getElementById('resume-btn').addEventListener('click', resumeGame); document.getElementById('restart-pause-btn').addEventListener('click', function() { startGame(gameMode); }); document.getElementById('quit-btn').addEventListener('click', quitToMenu); document.getElementById('retry-btn').addEventListener('click', function() { startGame(gameMode); }); document.getElementById('menu-quit-btn').addEventListener('click', quitToMenu); }

function gameLoop() { requestAnimationFrame(gameLoop); if (renderer && scene && camera) renderer.render(scene, camera); if (gameState === 'playing') { updateSinkingDice(); updateSinkingHighlights(); var activeCount = countActiveDice(); updateFullnessBar(activeCount / totalCells); if (gameMode !== 'battle' && activeCount >= totalCells) triggerGameOver(); if (gameMode === 'battle') updateFreezeDisplay(); } }
function updateSinkingHighlights() { for (var x = 0; x < GRID_COLS; x++) for (var y = 0; y < GRID_ROWS; y++) { var hl = sinkingHighlights[x] && sinkingHighlights[x][y]; if (hl) { var die = grid[x] && grid[x][y]; hl.visible = !!(die && die.state === 'sinking'); } } }

window.onload = function() { document.getElementById('menu-highscore').innerText = Number(highScore).toLocaleString(); initEngine(); setupControlListeners(); gameLoop(); };
