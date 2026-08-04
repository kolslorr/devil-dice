/**
 * Dicefall - Spec-Compliant Game Engine
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
// ── Deterministic RNG hook (headless playtester: ?seed=N) ──
(function() {
    var m = /[?&]seed=(\d+)/.exec(window.location.search);
    if (m) {
        var seed = parseInt(m[1], 10) || 1;
        Math.random = function() {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return seed / 4294967296;
        };
    }
})();
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
    boardFloor: 0x05030c, boardGrid: 0x33ddff,
    normalDie: { bg: '#3a2d52', pips: '#00ff88', border: '#7a68b8' },
    sinkingDie: { bg: '#17001a', pips: '#ff44cc', border: '#ff3366' },
    risingDie: { bg: '#081522', pips: '#33ccff', border: '#1f5380' },
    sinkingOne: { bg: '#15050a', pips: '#ff2f6d', border: '#ff88aa' },
    lockedBlock: { bg: '#101018', pips: '#667788', border: '#333344' },
    hoverGlow: { bg: '#1c0417', pips: '#ff2fd6', border: '#ff66e0' }
};
var CELL_TYPE = { EMPTY: 0, ACTIVE: 1, LOCKED: 2 };
var scene, camera, renderer, diceGroup, boardGroup, worldGroup;
var grid = [], score = 0, comboCount = 0;
var sinkingHighlights = [];
var highScore = localStorage.getItem('dicefall_zen_hs') ? parseInt(localStorage.getItem('dicefall_zen_hs')) : 0;
var puzzleProgress = localStorage.getItem('dicefall_puzzle_progress') ? parseInt(localStorage.getItem('dicefall_puzzle_progress')) : 0;
var gameState = 'menu', gameMode = 'zen', selectedDifficulty = 'medium', aiDifficulty = 'medium';
var soundEnabled = true, musicEnabled = true, spawnTimerId = null, activeSinkingGroups = [];
var totalCells = GRID_COLS * GRID_ROWS, boardSize = '7x7', animationLock = false;
var puzzleMovesRemaining = 0, puzzleCleared = false, puzzleStage = 1, puzzleMaxStages = 50;
var puzzleSavedBoardSize = null;
var aiTickInterval = null;
var battlePlayerScore = 0, battleAiScore = 0;
var battleTimeRemaining = 180, battleTimerId = null, battleDuration = 180;
var battleCurrentTurn = null;
var battlePlayerFrozenUntil = 0, battleAiFrozenUntil = 0;
var audioCtx = null, masterGain = null, compressorNode = null, sfxGain = null, musicGain = null;
var reverbConvolver = null, reverbGain = null, musicElements = {}, activeMusicMode = null, musicTimerId = null;
var TRACKS = { menu: 'audio/menu.mp3', zen: 'audio/zen.mp3', battle: 'audio/battle.mp3', puzzle: 'audio/puzzle.mp3', win: 'audio/win.mp3', lose: 'audio/lose.mp3' };
var textureCache = {}, materialsCache = {};
// ── Zen mode background effects ──
var zenAmbientParticles = null, zenFireworkBursts = [], zenFireworkTimerId = null;
var zenFireworkTimeouts = [];
var ZEN_FIREWORK_COLORS = [0xff3366, 0x33ccff, 0x66ff33, 0xffcc00, 0xcc66ff, 0xff8844, 0x44ffaa, 0xff66aa];
var ZEN_AMBIENT_COUNT = 320, zenAmbientPhase = 0, zenAmbientPulse = 0;
// ── AI battle move marker (gold ring + arrow on the die the AI moves) ──
var aiMoveMarker = null, aiMarkerDie = null, aiMarkerUntil = 0;
var AI_MARKER_COLOR = 0xffcc00, AI_MARKER_DURATION = 1100;
// ── Visual overhaul: bloom, nebula, stardust, circuit traces, aura ──
var composer = null, renderPass = null, bloomPass = null, vignettePass = null;
var BLOOM_STRENGTH = 0.6, BLOOM_RADIUS = 0.3, BLOOM_THRESHOLD = 0.8;
var nebulaMesh = null, nebulaMat = null, nebulaScene = null, nebulaCam = null, nebulaRT = null, nebulaScreen = null;
var stardustPoints = null, stardustPhase = 0, STARDUST_COUNT = 180;
var circuitTraceMesh = null, circuitTraceMat = null, circuitPulse = 0;
var auraPoints = null, AURA_MAX_PARTICLES = 48;
// ── High-end polish: procedural env map, dynamic light, particle trails ──
var nebulaEnvMap = null;
var dynamicLight = null, dynamicLightStrength = 0;
var _dynTargetPos = new THREE.Vector3(), _nebulaFwd = new THREE.Vector3();
var trailPoints = null, TRAIL_MAX_PARTICLES = 192;
var trailParts = null, trailHead = 0, trailLiveCount = 0, trailLastTime = 0;

var AudioEngine = {
    init: function() {
        if (audioCtx) return;
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            masterGain = audioCtx.createGain();
            masterGain.gain.value = 0.8;
            compressorNode = audioCtx.createDynamicsCompressor();
            compressorNode.threshold.value = -12;
            compressorNode.knee.value = 20;
            compressorNode.ratio.value = 4;
            compressorNode.attack.value = 0.003;
            compressorNode.release.value = 0.25;
            masterGain.connect(compressorNode);
            compressorNode.connect(audioCtx.destination);
            sfxGain = audioCtx.createGain();
            sfxGain.connect(compressorNode);
            musicGain = audioCtx.createGain();
            musicGain.gain.value = 0;
            musicGain.connect(compressorNode);
            reverbConvolver = audioCtx.createConvolver();
            reverbGain = audioCtx.createGain();
            reverbGain.gain.value = 0.3;
            reverbGain.connect(compressorNode);
            var irLen = Math.floor(audioCtx.sampleRate * 2);
            var irBuffer = audioCtx.createBuffer(2, irLen, audioCtx.sampleRate);
            for (var ch = 0; ch < 2; ch++) {
                var irData = irBuffer.getChannelData(ch);
                for (var i = 0; i < irLen; i++) {
                    irData[i] = (Math.random() * 2 - 1) * Math.exp(-3.5 * i / irLen);
                }
            }
            reverbConvolver.buffer = irBuffer;
            reverbConvolver.connect(reverbGain);
        } catch (e) { /* silent: audio must never break the game */ }
    },
    tone: function(opts) {
        if (!soundEnabled || !audioCtx || audioCtx.state === 'suspended') return;
        try {
            var t = opts.at || audioCtx.currentTime;
            var dur = opts.dur || 0.15;
            var attack = (opts.attack !== undefined) ? opts.attack : 0.005;
            var release = (opts.release !== undefined) ? opts.release : dur;
            var peak = opts.gain || 0.2;
            var o = audioCtx.createOscillator();
            o.type = opts.type || 'sine';
            o.frequency.setValueAtTime(opts.freq, t);
            if (opts.slideTo) o.frequency.exponentialRampToValueAtTime(opts.slideTo, t + dur);
            if (opts.detune) o.detune.value = opts.detune;
            var g = audioCtx.createGain();
            g.gain.setValueAtTime(0.0001, t);
            g.gain.linearRampToValueAtTime(peak, t + attack);
            g.gain.exponentialRampToValueAtTime(0.001, t + attack + release);
            var out = g;
            if (opts.pan !== undefined && audioCtx.createStereoPanner) {
                var pan = audioCtx.createStereoPanner();
                pan.pan.value = opts.pan;
                g.connect(pan);
                out = pan;
            }
            if (opts.reverbSend && reverbConvolver) {
                var send = audioCtx.createGain();
                send.gain.value = opts.reverbSend;
                g.connect(send);
                send.connect(reverbConvolver);
            }
            out.connect(sfxGain);
            o.connect(g);
            o.start(t);
            o.stop(t + attack + release + 0.05);
        } catch (e) { /* silent */ }
    },
    noiseBurst: function(opts) {
        if (!soundEnabled || !audioCtx || audioCtx.state === 'suspended') return;
        try {
            var t = audioCtx.currentTime;
            var dur = opts.dur || 0.1;
            var len = Math.max(1, Math.floor(audioCtx.sampleRate * dur));
            var buffer = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
            var data = buffer.getChannelData(0);
            for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
            var src = audioCtx.createBufferSource();
            src.buffer = buffer;
            var filter = audioCtx.createBiquadFilter();
            filter.type = opts.filterType || 'bandpass';
            filter.frequency.setValueAtTime(opts.freqFrom || 1000, t);
            if (opts.freqTo) filter.frequency.exponentialRampToValueAtTime(opts.freqTo, t + dur);
            if (opts.Q) filter.Q.value = opts.Q;
            var g = audioCtx.createGain();
            g.gain.setValueAtTime(opts.gain || 0.2, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + dur);
            src.connect(filter);
            filter.connect(g);
            g.connect(sfxGain);
            src.start(t);
            src.stop(t + dur + 0.05);
        } catch (e) { /* silent */ }
    },
    playMove: function() { this.tone({ freq: 130, slideTo: 70, type: 'sine', dur: 0.12, gain: 0.5, attack: 0.005 }); },
    playRoll: function() {
        if (!soundEnabled || !audioCtx || audioCtx.state === 'suspended') return;
        try {
            var jitter = 1 + (Math.random() * 0.1 - 0.05);
            this.noiseBurst({ dur: 0.05, gain: 0.25, filterType: 'bandpass', freqFrom: 1200 * jitter, freqTo: 500 * jitter });
            this.tone({ freq: 170 * jitter, slideTo: 80 * jitter, type: 'triangle', dur: 0.15, gain: 0.35, attack: 0.004 });
        } catch (e) { /* silent */ }
    },
    playSlide: function() { this.noiseBurst({ dur: 0.18, gain: 0.2, filterType: 'bandpass', freqFrom: 500, freqTo: 1800, Q: 0.8 }); },
    playMatch: function() {
        if (!soundEnabled || !audioCtx || audioCtx.state === 'suspended') return;
        try {
            this.tone({ freq: 660, type: 'sine', dur: 0.35, gain: 0.18, attack: 0.002, detune: -6, reverbSend: 0.5 });
            this.tone({ freq: 990, type: 'sine', dur: 0.35, gain: 0.16, attack: 0.002, detune: 6, reverbSend: 0.5 });
            this.noiseBurst({ dur: 0.08, gain: 0.12, filterType: 'highpass', freqFrom: 4000 });
        } catch (e) { /* silent */ }
    },
    playCombo: function(c) {
        if (!soundEnabled || !audioCtx || audioCtx.state === 'suspended') return;
        try {
            var shift = Math.min(parseInt(c, 10) || 1, 5) * 2;
            var mult = Math.pow(2, shift / 12);
            var base = [523.25, 659.25, 783.99];
            var start = audioCtx.currentTime + 0.01;
            for (var i = 0; i < base.length; i++) {
                this.tone({ freq: base[i] * mult, type: 'sine', dur: 0.2, gain: 0.16, attack: 0.003, reverbSend: 0.35, at: start + i * 0.06 });
            }
            this.tone({ freq: 1046.5 * mult * 2, type: 'sine', dur: 0.35, gain: 0.12, attack: 0.004, reverbSend: 0.4, at: start + base.length * 0.06 });
        } catch (e) { /* silent */ }
    },
    playGameOver: function() {
        if (!soundEnabled || !audioCtx || audioCtx.state === 'suspended') return;
        try {
            var notes = [392, 349.23, 311.13, 233.08];
            var start = audioCtx.currentTime + 0.01;
            for (var i = 0; i < notes.length; i++) {
                this.tone({ freq: notes[i], type: 'triangle', dur: 0.5, gain: 0.22, attack: 0.005, reverbSend: 0.5, at: start + i * 0.28 });
            }
            this.tone({ freq: 98, type: 'sine', dur: 1.2, gain: 0.18, attack: 0.02, reverbSend: 0.5, at: start });
        } catch (e) { /* silent */ }
    },
    playWin: function() {
        if (!soundEnabled || !audioCtx || audioCtx.state === 'suspended') return;
        try {
            var notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
            var start = audioCtx.currentTime + 0.01;
            for (var i = 0; i < notes.length; i++) {
                this.tone({ freq: notes[i], type: 'sine', dur: 0.35, gain: 0.2, attack: 0.003, reverbSend: 0.45, at: start + i * 0.09 });
                this.tone({ freq: notes[i], type: 'triangle', dur: 0.3, gain: 0.07, attack: 0.003, reverbSend: 0.3, at: start + i * 0.09 });
            }
        } catch (e) { /* silent */ }
    },
    playVictory: function() { this.setMusic('win'); },   // crossfade BGM -> win track
    playDefeat: function() { this.setMusic('lose'); },   // crossfade BGM -> lose track
    playLockBlock: function() { this.tone({ freq: 75, slideTo: 45, type: 'square', dur: 0.22, gain: 0.3, attack: 0.004 }); },
    playHaptic: function() {
        try { if (navigator.vibrate) navigator.vibrate(15); } catch (e) { /* silent */ }
        this.tone({ freq: 210, type: 'sine', dur: 0.05, gain: 0.15, attack: 0.002 });
    },
    playNoise: function(dur, gainVal) {
        this.noiseBurst({ dur: dur || 0.1, gain: gainVal || 0.12, filterType: 'highpass', freqFrom: 5000 });
    },
    ensureMusicElement: function(mode) {
        try {
            if (!musicElements[mode]) {
                var el = document.createElement('audio');
                el.src = TRACKS[mode];
                el.preload = 'auto';
                el.loop = true;
                document.body.appendChild(el);
                musicElements[mode] = el;
                if (audioCtx.createMediaElementSource) {
                    var source = audioCtx.createMediaElementSource(el);
                    source.connect(musicGain);
                }
            }
            return musicElements[mode];
        } catch (e) { return null; }
    },
    setMusic: function(mode) {
        if (!musicEnabled || !mode) return;
        this.init();
        if (!audioCtx || !musicGain) return;
        try {
            var now = audioCtx.currentTime;
            if (activeMusicMode === mode && musicElements[mode]) {
                var activeEl = musicElements[mode];
                musicGain.gain.cancelScheduledValues(now);
                musicGain.gain.setValueAtTime(Math.max(musicGain.gain.value, 0), now);
                musicGain.gain.linearRampToValueAtTime(0.55, now + 0.8);
                var activePlay = null;
                try { activePlay = activeEl.play(); } catch (e) { activePlay = null; }
                if (activePlay && activePlay.catch) {
                    activePlay.catch(function() {
                        setTimeout(function() { try { activeEl.play().catch(function() {}); } catch (e) { /* silent */ } }, 300);
                    });
                }
                return;
            }
            if (musicTimerId) { clearTimeout(musicTimerId); musicTimerId = null; }
            var current = null;
            for (var m in musicElements) {
                if (musicElements[m] && !musicElements[m].paused) { current = musicElements[m]; break; }
            }
            if (current && current !== musicElements[mode]) {
                musicGain.gain.cancelScheduledValues(now);
                musicGain.gain.setValueAtTime(Math.max(musicGain.gain.value, 0), now);
                musicGain.gain.linearRampToValueAtTime(0, now + 0.5);
                musicGain.gain.setValueAtTime(0, now + 0.55);
                musicGain.gain.linearRampToValueAtTime(0.55, now + 0.55 + 0.8);
                var currentEl = current;
                musicTimerId = setTimeout(function() {
                    musicTimerId = null;
                    try { if (!currentEl.paused) currentEl.pause(); } catch (e) { /* silent */ }
                }, 550);
            }
            var el = this.ensureMusicElement(mode);
            if (!el) return;
            if (!current) {
                musicGain.gain.cancelScheduledValues(now);
                musicGain.gain.setValueAtTime(0, now);
                musicGain.gain.linearRampToValueAtTime(0.55, now + 0.8);
            }
            var playResult = null;
            try { playResult = el.play(); } catch (e) { playResult = null; }
            if (playResult && playResult.catch) {
                playResult.catch(function() {
                    setTimeout(function() { try { el.play().catch(function() {}); } catch (e) { /* silent */ } }, 300);
                });
            }
            activeMusicMode = mode;
        } catch (e) { /* silent */ }
    },
    startBGM: function(mode) { this.setMusic(mode || 'zen'); },
    stopBGM: function() {
        try {
            if (musicTimerId) { clearTimeout(musicTimerId); musicTimerId = null; }
            if (audioCtx && musicGain) {
                var now = audioCtx.currentTime;
                musicGain.gain.cancelScheduledValues(now);
                musicGain.gain.setValueAtTime(Math.max(musicGain.gain.value, 0), now);
                musicGain.gain.linearRampToValueAtTime(0, now + 0.5);
            }
            var els = musicElements;
            musicTimerId = setTimeout(function() {
                musicTimerId = null;
                try {
                    for (var m in els) { if (els[m] && !els[m].paused) els[m].pause(); }
                } catch (e) { /* silent */ }
            }, 550);
            activeMusicMode = null;
        } catch (e) { /* silent */ }
    },
    startMenuMusic: function() { this.setMusic('menu'); },
    stopMenuMusic: function() { this.stopBGM(); }
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
    grad.addColorStop(0, 'rgba(255,255,255,0.05)'); grad.addColorStop(1, 'rgba(0,0,0,0.22)'); ctx.fillStyle = grad; ctx.fill();
    ctx.fillStyle = colors.pips; ctx.shadowBlur = 5; ctx.shadowColor = colors.pips;
    var pipR = 10, pad = 32;
    var pos = { c: [64, 64], tl: [pad, pad], tr: [128 - pad, pad], bl: [pad, 128 - pad], br: [128 - pad, 128 - pad], ml: [pad, 64], mr: [128 - pad, 64] };
    function dp(p) { ctx.beginPath(); ctx.arc(p[0], p[1], pipR, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(8,5,16,0.85)'; ctx.lineWidth = 3; ctx.stroke(); ctx.fill(); }
    switch (value) { case 1: dp(pos.c); break; case 2: dp(pos.tl); dp(pos.br); break; case 3: dp(pos.tl); dp(pos.c); dp(pos.br); break; case 4: dp(pos.tl); dp(pos.tr); dp(pos.bl); dp(pos.br); break; case 5: dp(pos.tl); dp(pos.tr); dp(pos.c); dp(pos.bl); dp(pos.br); break; case 6: dp(pos.tl); dp(pos.tr); dp(pos.ml); dp(pos.mr); dp(pos.bl); dp(pos.br); break; }
    if (rot > 0) { var rcv = document.createElement('canvas'); rcv.width = 128; rcv.height = 128; var rctx = rcv.getContext('2d'); rctx.translate(64, 64); rctx.rotate(rot * Math.PI / 2); rctx.drawImage(cv, -64, -64); cv = rcv; }
    var tex = new THREE.CanvasTexture(cv); textureCache[ck] = tex; return tex;
}

// Emissive-only texture: black base with bright pips so the bloom pass picks
// up only the neon pips, not the dark die body.
function getDiceEmissiveTexture(value, state, rot) {
    rot = rot || 0; state = state || 'normal'; var ck = 'e_' + value + '_' + state + '_r' + rot; if (textureCache[ck]) return textureCache[ck];
    var cv = document.createElement('canvas'); cv.width = 128; cv.height = 128; var ctx = cv.getContext('2d');
    var colors = PALETTE.normalDie;
    if (state === 'sinking') colors = PALETTE.sinkingDie; if (state === 'rising') colors = PALETTE.risingDie;
    if (state === 'sinking_one') colors = PALETTE.sinkingOne; if (state === 'locked') colors = PALETTE.lockedBlock;
    if (state === 'hover') colors = PALETTE.hoverGlow;
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = '#ffffff'; ctx.shadowBlur = 4; ctx.shadowColor = colors.pips;
    var pipR = 10, pad = 32;
    var pos = { c: [64, 64], tl: [pad, pad], tr: [128 - pad, pad], bl: [pad, 128 - pad], br: [128 - pad, 128 - pad], ml: [pad, 64], mr: [128 - pad, 64] };
    function dp(p) { ctx.beginPath(); ctx.arc(p[0], p[1], pipR, 0, Math.PI * 2); ctx.fill(); }
    switch (value) { case 1: dp(pos.c); break; case 2: dp(pos.tl); dp(pos.br); break; case 3: dp(pos.tl); dp(pos.c); dp(pos.br); break; case 4: dp(pos.tl); dp(pos.tr); dp(pos.bl); dp(pos.br); break; case 5: dp(pos.tl); dp(pos.tr); dp(pos.c); dp(pos.bl); dp(pos.br); break; case 6: dp(pos.tl); dp(pos.tr); dp(pos.ml); dp(pos.mr); dp(pos.bl); dp(pos.br); break; }
    if (rot > 0) { var rcv = document.createElement('canvas'); rcv.width = 128; rcv.height = 128; var rctx = rcv.getContext('2d'); rctx.translate(64, 64); rctx.rotate(rot * Math.PI / 2); rctx.drawImage(cv, -64, -64); cv = rcv; }
    var tex = new THREE.CanvasTexture(cv); textureCache[ck] = tex; return tex;
}

// RoundedBoxGeometry does not exist at three r128 (added in r130), so beveled
// dice edges are simulated with a canvas-generated tangent-space normal map:
// a smooth height falloff around the rounded-rect border plus raised pip domes.
function getDiceNormalTexture(value, rot) {
    rot = rot || 0;
    var ck = 'n_' + value + '_r' + rot;
    if (textureCache[ck]) return textureCache[ck];
    var S = 128, m = 6, cr = 12, bevel = 13, pipR = 10, pad = 32;
    var centers = [];
    if (value === 1) centers = [[64, 64]];
    else if (value === 2) centers = [[pad, pad], [S - pad, S - pad]];
    else if (value === 3) centers = [[pad, pad], [64, 64], [S - pad, S - pad]];
    else if (value === 4) centers = [[pad, pad], [S - pad, pad], [pad, S - pad], [S - pad, S - pad]];
    else if (value === 5) centers = [[pad, pad], [S - pad, pad], [64, 64], [pad, S - pad], [S - pad, S - pad]];
    else centers = [[pad, pad], [S - pad, pad], [pad, 64], [S - pad, 64], [pad, S - pad], [S - pad, S - pad]];
    var hw = S / 2 - m, hh = S / 2 - m;
    function heightAt(px, py) {
        var qx = Math.abs(px - S / 2) - (hw - cr);
        var qy = Math.abs(py - S / 2) - (hh - cr);
        var ox = Math.max(qx, 0), oy = Math.max(qy, 0);
        var sd = Math.sqrt(ox * ox + oy * oy) - cr + Math.min(Math.max(qx, qy), 0);
        var h = 0.5 - sd / (bevel * 2);
        if (h < 0) h = 0; else if (h > 1) h = 1;
        for (var pi = 0; pi < centers.length; pi++) {
            var dx = px - centers[pi][0], dy = py - centers[pi][1];
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < pipR) h += 0.28;
            else if (dist < pipR + 4) h += 0.28 * (1 - (dist - pipR) / 4);
        }
        return h;
    }
    var heights = new Float32Array(S * S);
    for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) heights[y * S + x] = heightAt(x + 0.5, y + 0.5);
    var cv = document.createElement('canvas'); cv.width = S; cv.height = S;
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(S, S), px = img.data, gain = 1.8;
    for (var y = 0; y < S; y++) {
        var yU = y > 0 ? y - 1 : y, yD = y < S - 1 ? y + 1 : y;
        for (var x = 0; x < S; x++) {
            var xL = x > 0 ? x - 1 : x, xR = x < S - 1 ? x + 1 : x;
            var i = y * S + x;
            var gx = (heights[y * S + xL] - heights[y * S + xR]) * gain;
            var gy = (heights[yD * S + x] - heights[yU * S + x]) * gain;
            var inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
            px[i * 4] = (0.5 - gx * inv * 0.5) * 255;
            px[i * 4 + 1] = (0.5 + gy * inv * 0.5) * 255;
            px[i * 4 + 2] = (0.5 + inv * 0.5) * 255;
            px[i * 4 + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    if (rot > 0) {
        var rcv = document.createElement('canvas'); rcv.width = S; rcv.height = S;
        var rctx = rcv.getContext('2d');
        rctx.translate(S / 2, S / 2); rctx.rotate(rot * Math.PI / 2); rctx.drawImage(cv, -S / 2, -S / 2);
        cv = rcv;
    }
    var tex = new THREE.CanvasTexture(cv);
    textureCache[ck] = tex;
    return tex;
}

// Tiny procedural 6-face cube environment map matching the nebula palette so
// the obsidian dice pick up deep purple/blue/magenta reflections. No assets.
function createNebulaEnvMap() {
    if (nebulaEnvMap) return nebulaEnvMap;
    var stops = [
        ['#1a0b3a', '#0a2a5e', '#6a1b6a'],
        ['#0a2a5e', '#6a1b6a', '#1a0b3a'],
        ['#6a1b6a', '#1a0b3a', '#0a2a5e'],
        ['#14072e', '#3a0f4d', '#0d1c44'],
        ['#0d1c44', '#14072e', '#3a0f4d'],
        ['#3a0f4d', '#0d1c44', '#14072e']
    ];
    var images = [];
    for (var f = 0; f < 6; f++) {
        var cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
        var ctx = cv.getContext('2d');
        var g = ctx.createLinearGradient(0, 0, 64, 64);
        g.addColorStop(0, stops[f][0]); g.addColorStop(0.55, stops[f][1]); g.addColorStop(1, stops[f][2]);
        ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
        var rg = ctx.createRadialGradient(22, 22, 3, 32, 32, 42);
        rg.addColorStop(0, 'rgba(255,110,235,0.95)');
        rg.addColorStop(0.3, 'rgba(120,80,255,0.28)');
        rg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = rg; ctx.fillRect(0, 0, 64, 64);
        images.push(cv);
    }
    nebulaEnvMap = new THREE.CubeTexture(images);
    nebulaEnvMap.needsUpdate = true;
    return nebulaEnvMap;
}

function getDiceMaterials(faces, state) {
    state = state || 'normal';
    var key = faces.right + '_' + faces.left + '_' + faces.top + '_' + faces.bottom + '_' + faces.back + '_' + faces.front + '_' + state + '_v6';
    if (materialsCache[key]) return materialsCache[key];
    var emissiveColor = 0x00ff88, intensity = 2.4;
    if (state === 'hover') { emissiveColor = 0xff2fd6; intensity = 1.8; }
    else if (state === 'sinking') { emissiveColor = 0xff44cc; intensity = 1.5; }
    else if (state === 'sinking_one') { emissiveColor = 0xff2f6d; intensity = 1.5; }
    else if (state === 'rising') { emissiveColor = 0x33ccff; intensity = 1.6; }
    else if (state === 'locked') { emissiveColor = 0x667788; intensity = 0.5; }
    var env = createNebulaEnvMap();
    function faceMat(fv, rot) {
        return new THREE.MeshStandardMaterial({
            map: getDiceTexture(fv, state, rot),
            emissive: emissiveColor,
            emissiveMap: getDiceEmissiveTexture(fv, state, rot),
            emissiveIntensity: intensity,
            roughness: 0.5,
            metalness: 0.3,
            envMap: env,
            envMapIntensity: 0.25,
            normalMap: getDiceNormalTexture(fv, rot)
        });
    }
    var mats = [
        faceMat(faces.right, 0),
        faceMat(faces.left, 0),
        faceMat(faces.top, 1),
        faceMat(faces.bottom, 1),
        faceMat(faces.front, 0),
        faceMat(faces.back, 0)
    ];
    if (state === 'sinking' || state === 'sinking_one') mats.forEach(function(m) { m.transparent = true; m.opacity = 1.0; });
    materialsCache[key] = mats; return mats;
}

function Die(gridX, gridY, topValue, cellType, rotY) {
    this.gridX = gridX; this.gridY = gridY;
    this.cellType = (typeof cellType === 'undefined') ? CELL_TYPE.ACTIVE : cellType;
    this.state = (this.cellType === CELL_TYPE.LOCKED) ? 'locked' : 'rising';
    this.height = (this.cellType === CELL_TYPE.LOCKED) ? 0.0 : -1.0;
    this.sinkingGroup = null; this.sinkingTimer = 0;
    this.faces = Object.assign({}, INITIAL_DIE_FACES);
    if (this.cellType === CELL_TYPE.LOCKED) { this.faces = { top: 0, bottom: 0, front: 0, back: 0, left: 0, right: 0 }; }
    else if (typeof topValue !== 'undefined' && topValue !== null && topValue !== 1) {
        this.forceTopValue(topValue);
        if (typeof rotY === 'number') {
            // Deterministic side faces for authored puzzle dice: neutralize the
            // random Y-rotation applied by forceTopValue and apply rotY (0..3).
            this.faces = Object.assign({}, STANDARD_ORIENTATIONS[topValue]);
            for (var ry = 0; ry < rotY; ry++) this._rotY();
        }
    }
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
    var wy = this.height + DIE_SCALE / 2;
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
        else { self.state = 'normal'; self.height = 0; self.mesh.material = getDiceMaterials(self.faces, 'normal'); self._syncPivot(); if (gameMode === 'battle') battleCurrentTurn = null; checkAllMatches(); }
    }
    requestAnimationFrame(tick);
};
Die.prototype.roll = function(direction, onComplete) {
    if (this.state !== 'normal' && this.state !== 'locked') { if (onComplete) onComplete(false); return; }
    if (this.cellType === CELL_TYPE.LOCKED) { if (onComplete) onComplete(false); return; }
    this.state = 'rolling'; var sx = this.gridX, sy = this.gridY, d = DIRECTIONS[direction], ex = sx + d.dx, ey = sy + d.dy;
    if (ex < 0 || ex >= GRID_COLS || ey < 0 || ey >= GRID_ROWS) { this.state = 'normal'; if (onComplete) onComplete(false); return; }
    if (grid[ex][ey] !== null) { this.state = 'normal'; AudioEngine.playMove(); if (onComplete) onComplete(false); return; }
    grid[sx][sy] = null; grid[ex][ey] = this; this.gridX = ex; this.gridY = ey;
    var old = Object.assign({}, this.faces), axis = new THREE.Vector3();
    if (direction === 'east') { this.faces.top = old.left; this.faces.right = old.top; this.faces.bottom = old.right; this.faces.left = old.bottom; axis.set(0, 0, -1); }
    else if (direction === 'west') { this.faces.top = old.right; this.faces.left = old.top; this.faces.bottom = old.left; this.faces.right = old.bottom; axis.set(0, 0, 1); }
    else if (direction === 'south') { this.faces.top = old.back; this.faces.front = old.top; this.faces.bottom = old.front; this.faces.back = old.bottom; axis.set(1, 0, 0); }
    else if (direction === 'north') { this.faces.top = old.front; this.faces.back = old.top; this.faces.bottom = old.back; this.faces.front = old.bottom; axis.set(-1, 0, 0); }
    AudioEngine.playRoll();
    var self = this, startTime = Date.now(), sWX = (sx - (GRID_COLS - 1) / 2) * GRID_SPACING, sWZ = (sy - (GRID_ROWS - 1) / 2) * GRID_SPACING;
    var eWX = (ex - (GRID_COLS - 1) / 2) * GRID_SPACING, eWZ = (ey - (GRID_ROWS - 1) / 2) * GRID_SPACING;
    // Neon magenta while the die is being controlled so bloom + aura track it.
    self.mesh.material = getDiceMaterials(self.faces, 'hover');
    function tick() {
        var elapsed = Date.now() - startTime, p = Math.min(elapsed / ROLL_DURATION, 1.0), ease = 1 - Math.pow(1 - p, 3);
        self.pivotGroup.position.set(sWX + ease * (eWX - sWX), Math.sin(p * Math.PI) * 0.18, sWZ + ease * (eWZ - sWZ));
        self.pivotGroup.setRotationFromAxisAngle(axis, ease * (Math.PI / 2));
        if (p < 1) requestAnimationFrame(tick);
        else {
            self.pivotGroup.rotation.set(0, 0, 0); self.pivotGroup.position.set(eWX, 0, eWZ);
            self.state = 'normal'; self.height = 0; self.mesh.material = getDiceMaterials(self.faces, 'normal'); self._syncPivot(); if (onComplete) onComplete(true);
        }
    }
    requestAnimationFrame(tick);
};
Die.prototype.slide = function(direction, onComplete) {
    if (this.state !== 'normal') { if (onComplete) onComplete(false); return; }
    if (this.cellType === CELL_TYPE.LOCKED) { if (onComplete) onComplete(false); return; }
    var d = DIRECTIONS[direction], tx = this.gridX + d.dx, ty = this.gridY + d.dy;
    if (tx < 0 || tx >= GRID_COLS || ty < 0 || ty >= GRID_ROWS) { if (onComplete) onComplete(false); return; }
    if (grid[tx][ty] === null) { this._execSlide(direction, onComplete); return; }
    if (grid[tx][ty] !== null) { AudioEngine.playMove(); if (onComplete) onComplete(false); return; }
};
Die.prototype._execSlide = function(direction, onComplete) {
    this.state = 'sliding'; var sx = this.gridX, sy = this.gridY, d = DIRECTIONS[direction], ex = sx + d.dx, ey = sy + d.dy;
    grid[sx][sy] = null; grid[ex][ey] = this; this.gridX = ex; this.gridY = ey; AudioEngine.playSlide();
    this.mesh.material = getDiceMaterials(this.faces, 'hover');
    var self = this, startTime = Date.now(), sWX = (sx - (GRID_COLS - 1) / 2) * GRID_SPACING, sWZ = (sy - (GRID_ROWS - 1) / 2) * GRID_SPACING;
    var eWX = (ex - (GRID_COLS - 1) / 2) * GRID_SPACING, eWZ = (ey - (GRID_ROWS - 1) / 2) * GRID_SPACING;
    function tick() { var p = Math.min((Date.now() - startTime) / SLIDE_DURATION, 1.0), ease = 1 - Math.pow(1 - p, 2); self.pivotGroup.position.set(sWX + ease * (eWX - sWX), 0, sWZ + ease * (eWZ - sWZ)); if (p < 1) requestAnimationFrame(tick); else { self.state = 'normal'; self.height = 0; self.mesh.material = getDiceMaterials(self.faces, 'normal'); self._syncPivot(); if (onComplete) onComplete(true); } }
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Real shadow maps are intentionally OFF (software-GL perf); depth is
    // conveyed via point-light falloff + emissive response instead.
    renderer.shadowMap.enabled = false;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);
    setupOrthoCamera();
    initNebula(); initStardust(); initAura(); initTrails(); createComposer();
    var al = new THREE.AmbientLight(0x8899ff, 0.5); scene.add(al);
    var dl = new THREE.DirectionalLight(0xddeeff, 0.9); dl.position.set(8, 14, 5); scene.add(dl);
    var pl = new THREE.PointLight(0xff2fd6, 0.6, 28); pl.position.set(-4, 3, -4); scene.add(pl);
    dynamicLight = new THREE.PointLight(0xff2fd6, 1.2, 14, 1.8);
    dynamicLight.position.set(0, 8, 0);
    dynamicLight.visible = false;
    scene.add(dynamicLight);
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    resizeComposer(); resizeNebula();
    camera.left = -halfH; camera.right = halfH; camera.top = halfV; camera.bottom = -halfV; camera.updateProjectionMatrix();
}


function buildBoard() {
    boardGroup.clear(); var bw = GRID_COLS * GRID_SPACING, bh = GRID_ROWS * GRID_SPACING;
    var bezelGeom = new THREE.BoxGeometry(bw + 0.4, 0.4, bh + 0.4), bezelMat = new THREE.MeshPhongMaterial({ color: 0x0c0916, specular: 0x334466, shininess: 60 });
    var bezel = new THREE.Mesh(bezelGeom, bezelMat); bezel.position.y = -0.2; bezel.receiveShadow = true; boardGroup.add(bezel);
    bezelMat.envMap = createNebulaEnvMap();
    bezelMat.reflectivity = 0.35;
    var rimMat = new THREE.LineBasicMaterial({ color: 0xff2fd6, transparent: true, opacity: 0.45, depthTest: true });
    var rim = new THREE.LineSegments(new THREE.EdgesGeometry(bezelGeom), rimMat);
    rim.position.y = -0.2;
    rim.renderOrder = 3;
    boardGroup.add(rim);
    sinkingHighlights = Array(GRID_COLS).fill(null).map(function() { return Array(GRID_ROWS).fill(null); });
    var hlGeom = new THREE.PlaneGeometry(GRID_SPACING - 0.12, GRID_SPACING - 0.12);
    var hlMat = new THREE.MeshBasicMaterial({ color: 0xff3366, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthTest: false });
    for (var x = 0; x < GRID_COLS; x++) for (var y = 0; y < GRID_ROWS; y++) {
        var tileGeom = new THREE.BoxGeometry(GRID_SPACING - 0.08, 0.1, GRID_SPACING - 0.08), isDark = (x + y) % 2 === 0;
        var tileMat = new THREE.MeshPhongMaterial({ color: isDark ? 0x0d0a16 : 0x120e1e, specular: 0x224466, shininess: 90, emissive: PALETTE.boardGrid, emissiveIntensity: 0.06 });
        var tile = new THREE.Mesh(tileGeom, tileMat); tile.position.set((x - (GRID_COLS - 1) / 2) * GRID_SPACING, -0.05, (y - (GRID_ROWS - 1) / 2) * GRID_SPACING);
        tile.receiveShadow = true; boardGroup.add(tile);
        var hl = new THREE.Mesh(hlGeom, hlMat);
        hl.rotation.x = -Math.PI / 2;
        hl.position.set((x - (GRID_COLS - 1) / 2) * GRID_SPACING, 0.01, (y - (GRID_ROWS - 1) / 2) * GRID_SPACING);
        hl.visible = false; boardGroup.add(hl);
        sinkingHighlights[x][y] = hl;
    }
    ensureCircuitTrace(bw, bh);
}

// ── Post-processing: full-res bloom + subtle vignette ──
function createComposer() {
    if (!renderer || !scene || !camera) return;
    if (!THREE.EffectComposer || !THREE.RenderPass || !THREE.UnrealBloomPass || !THREE.ShaderPass) return;
    composer = new THREE.EffectComposer(renderer);
    renderPass = new THREE.RenderPass(scene, camera);
    // Bloom at half resolution: UnrealBloomPass's internal bright/blur chain
    // runs at the resolution we pass in. Half-res keeps the scene itself crisp
    // (RenderPass is full-res) while making the glow soft AND cutting the
    // SwiftShader/mobile cost roughly 4x. Visually this is closer to the
    // "subtle glow" target than full-res bloom.
    var bloomRes = new THREE.Vector2(
        Math.max(64, Math.floor(window.innerWidth / 2)),
        Math.max(64, Math.floor(window.innerHeight / 2))
    );
    bloomPass = new THREE.UnrealBloomPass(bloomRes, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    if (THREE.VignetteShader) {
        vignettePass = new THREE.ShaderPass(THREE.VignetteShader);
        if (vignettePass.uniforms.offset) vignettePass.uniforms.offset.value = 1.05;
        if (vignettePass.uniforms.darkness) vignettePass.uniforms.darkness.value = 0.55;
        composer.addPass(vignettePass);
    }
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    composer.setSize(window.innerWidth, window.innerHeight);
}
function resizeComposer() {
    if (!composer) return;
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    composer.setSize(window.innerWidth, window.innerHeight);
}

// ── Dynamic swirling nebula background (deep purples / blues / cyans) ──
function initNebula() {
    if (nebulaMesh) return;
    nebulaMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uAspect: { value: window.innerWidth / Math.max(1, window.innerHeight) } },
        vertexShader: [
            'varying vec2 vUv;',
            'void main() {',
            '    vUv = uv;',
            '    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
            '}'
        ].join('\n'),
        fragmentShader: [
            'uniform float uTime;',
            'uniform float uAspect;',
            'varying vec2 vUv;',
            'float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }',
            'float noise(vec2 p) {',
            '    vec2 i = floor(p); vec2 f = fract(p);',
            '    f = f * f * (3.0 - 2.0 * f);',
            '    float a = hash(i); float b = hash(i + vec2(1.0, 0.0));',
            '    float c = hash(i + vec2(0.0, 1.0)); float d = hash(i + vec2(1.0, 1.0));',
            '    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);',
            '}',
            'float fbm(vec2 p) {',
            '    float v = 0.0; float amp = 0.5;',
            '    for (int i = 0; i < 3; i++) { v += amp * noise(p); p = p * 2.05 + vec2(13.7, 7.3); amp *= 0.5; }',
            '    return v;',
            '}',
            'void main() {',
            '    vec2 p = vec2(vUv.x * uAspect, vUv.y) * 2.0 - vec2(uAspect, 1.0);',
            '    float t = uTime * 0.035;',
            '    float ang = uTime * 0.02;',
            '    float ca = cos(ang); float sa = sin(ang);',
            '    vec2 q = vec2(ca * p.x - sa * p.y, sa * p.x + ca * p.y);',
            '    vec2 drift = vec2(t * 0.6, t * 0.4);',
            '    float n1 = fbm(q * 1.2 + drift);',
            '    float n2 = fbm(q * 2.1 - drift * 0.8 + n1 * 1.1);',
            '    float n3 = fbm(q * 3.6 + drift * 0.5 + n2 * 1.3);',
            '    float swirl = n1 * 0.5 + n2 * 0.32 + n3 * 0.18;',
            '    vec3 c1 = vec3(0.102, 0.043, 0.227);',
            '    vec3 c2 = vec3(0.039, 0.165, 0.369);',
            '    vec3 c3 = vec3(0.416, 0.106, 0.416);',
            '    vec3 col = mix(c1, c2, smoothstep(0.18, 0.72, swirl));',
            '    col = mix(col, c3, smoothstep(0.62, 0.95, swirl));',
            '    vec2 sc = floor(p * 18.0);',
            '    float star = step(0.9965, hash(sc));',
            '    star *= 0.5 + 0.5 * sin(uTime * 1.6 + hash(sc + 7.0) * 40.0);',
            '    col += vec3(0.75, 0.85, 1.0) * star * 0.32;',
            '    col *= 0.9 + 0.1 * smoothstep(1.3, 0.4, length(p * vec2(0.8, 1.0)));',
            '    gl_FragColor = vec4(col, 1.0);',
            '}'
        ].join('\n'),
        depthWrite: false, depthTest: false, fog: false
    });
    // The shader mesh lives only in the low-res RT scene: a 2x2 plane under an
    // ortho -1..1 camera fills the entire render target with vUv 0..1.
    nebulaMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), nebulaMat);
    nebulaMesh.renderOrder = -10;
    nebulaMesh.frustumCulled = false;
    // Low-res render target: the nebula shader is animated every frame, so
    // render it at reduced resolution (1/4 linear = 1/16 pixels) and blit it
    // up. fbm noise on a dark background is indistinguishable at low res and
    // this keeps SwiftShader/mobile main threads from being saturated (which
    // otherwise starves the networkIdle lifecycle event in headless tests).
    nebulaScene = new THREE.Scene();
    nebulaCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    nebulaCam.position.z = 1;
    nebulaScene.add(nebulaMesh);
    var rtW = Math.max(64, Math.floor(window.innerWidth / 4));
    var rtH = Math.max(64, Math.floor(window.innerHeight / 4));
    nebulaRT = new THREE.WebGLRenderTarget(rtW, rtH, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat });
    nebulaScreen = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.MeshBasicMaterial({ map: nebulaRT.texture, depthWrite: false, depthTest: false, fog: false })
    );
    nebulaScreen.renderOrder = -10;
    nebulaScreen.frustumCulled = false;
    scene.add(nebulaScreen);
    resizeNebula();
}
function resizeNebula() {
    if (!nebulaMesh) return;
    var boardHalf = Math.max(GRID_COLS, GRID_ROWS) * GRID_SPACING / 2 + GRID_SPACING * 0.7;
    var aspect = window.innerWidth / window.innerHeight;
    var halfH = boardHalf, halfV = boardHalf;
    if (aspect < 1) halfV = boardHalf / aspect;
    else halfH = boardHalf * aspect;
    if (nebulaMat && nebulaMat.uniforms) nebulaMat.uniforms.uAspect.value = window.innerWidth / Math.max(1, window.innerHeight);
    if (nebulaRT) {
        var rtW = Math.max(64, Math.floor(window.innerWidth / 4));
        var rtH = Math.max(64, Math.floor(window.innerHeight / 4));
        nebulaRT.setSize(rtW, rtH);
    }
    if (nebulaScreen) {
        // True fullscreen blit: center the quad on the camera's view axis and
        // size it to the ortho frustum cross-section (plus margin) so no edge
        // can ever show, at any aspect ratio or camera angle.
        camera.updateMatrixWorld(true);
        _nebulaFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
        nebulaScreen.position.copy(camera.position).addScaledVector(_nebulaFwd, 42);
        nebulaScreen.lookAt(camera.position);
        nebulaScreen.scale.set(halfH * 2.08, halfV * 2.08, 1);
    }
}
function updateNebula() {
    if (nebulaMat && nebulaMat.uniforms) nebulaMat.uniforms.uTime.value = performance.now() * 0.001;
    // Render the animated nebula into the low-res RT, then blit via nebulaScreen
    if (nebulaRT && nebulaScene && nebulaCam && renderer) {
        var prevRT = renderer.getRenderTarget();
        renderer.setRenderTarget(nebulaRT);
        renderer.render(nebulaScene, nebulaCam);
        renderer.setRenderTarget(prevRT);
    }
}

// ── Stardust particle field drifting behind the board ──
function initStardust() {
    if (stardustPoints) return;
    var positions = new Float32Array(STARDUST_COUNT * 3);
    var colors = new Float32Array(STARDUST_COUNT * 3);
    var seeds = [];
    for (var i = 0; i < STARDUST_COUNT; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 26;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 18;
        positions[i * 3 + 2] = -1.5 - Math.random() * 4.5;
        var c = new THREE.Color().setHSL(0.55 + Math.random() * 0.22, 0.75, 0.5 + Math.random() * 0.4);
        colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
        seeds.push({ phase: Math.random() * Math.PI * 2, speed: 0.3 + Math.random() * 0.9, drift: 0.002 + Math.random() * 0.006 });
    }
    var geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    var mat = new THREE.PointsMaterial({
        size: 0.4, vertexColors: true, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, sizeAttenuation: true
    });
    stardustPoints = new THREE.Points(geom, mat);
    stardustPoints.renderOrder = -9;
    stardustPoints.userData.seeds = seeds;
    scene.add(stardustPoints);
}
function updateStardust() {
    if (!stardustPoints) return;
    stardustPhase += 0.02;
    var pos = stardustPoints.geometry.attributes.position;
    var seeds = stardustPoints.userData.seeds;
    for (var i = 0; i < STARDUST_COUNT && seeds && i < seeds.length; i++) {
        var s = seeds[i];
        pos.array[i * 3] += Math.sin(stardustPhase * 0.7 + s.phase) * 0.002 + s.drift;
        pos.array[i * 3 + 1] += Math.cos(stardustPhase * 0.5 + s.phase) * 0.002 + Math.sin(stardustPhase * 0.3 + s.phase * 2.0) * 0.001;
        if (pos.array[i * 3] > 13) pos.array[i * 3] = -13;
        if (pos.array[i * 3] < -13) pos.array[i * 3] = 13;
        if (pos.array[i * 3 + 1] > 9) pos.array[i * 3 + 1] = -9;
        if (pos.array[i * 3 + 1] < -9) pos.array[i * 3 + 1] = 9;
    }
    pos.needsUpdate = true;
}

// ── Pulsing emissive circuit-trace layer beneath the glass board ──
function ensureCircuitTrace(bw, bh) {
    if (!circuitTraceMesh) {
        var cv = document.createElement('canvas'); cv.width = 256; cv.height = 256; var ctx = cv.getContext('2d');
        ctx.clearRect(0, 0, 256, 256);
        ctx.strokeStyle = 'rgba(140, 255, 240, 1)'; ctx.lineWidth = 2;
        for (var i = 0; i < 90; i++) {
            ctx.beginPath();
            var x = Math.random() * 256, y = Math.random() * 256;
            ctx.moveTo(x, y);
            var hdir = Math.random() < 0.5;
            for (var sgm = 0; sgm < 4; sgm++) {
                if (hdir) x += (Math.random() < 0.5 ? -1 : 1) * (22 + Math.random() * 55);
                else y += (Math.random() < 0.5 ? -1 : 1) * (22 + Math.random() * 55);
                ctx.lineTo(Math.max(2, Math.min(254, x)), Math.max(2, Math.min(254, y)));
                hdir = !hdir;
            }
            ctx.stroke();
        }
        ctx.fillStyle = 'rgba(140, 255, 240, 1)';
        for (var j = 0; j < 40; j++) { ctx.beginPath(); ctx.arc(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 2, 0, Math.PI * 2); ctx.fill(); }
        var tex = new THREE.CanvasTexture(cv);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        circuitTraceMat = new THREE.ShaderMaterial({
            uniforms: {
                map: { value: tex },
                uTime: { value: 0 },
                uOffset: { value: new THREE.Vector2(0, 0) },
                uLightPos: { value: new THREE.Vector3(0, 0, 0) },
                uLightStrength: { value: 0 }
            },
            vertexShader: [
                'varying vec2 vUv;',
                'varying vec3 vWorldPos;',
                'void main() {',
                '    vUv = uv;',
                '    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;',
                '    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
                '}'
            ].join('\n'),
            fragmentShader: [
                'uniform sampler2D map;',
                'uniform float uTime;',
                'uniform vec2 uOffset;',
                'uniform vec3 uLightPos;',
                'uniform float uLightStrength;',
                'varying vec2 vUv;',
                'varying vec3 vWorldPos;',
                'void main() {',
                '    vec2 tuv = vUv + uOffset;',
                '    vec4 texel = texture2D(map, tuv);',
                '    float pulse = 0.5 + 0.5 * sin(uTime * 1.6 + (vUv.x * 3.0 + vUv.y * 5.0) * 0.45);',
                '    vec2 delta = vWorldPos.xz - uLightPos.xz;',
                '    float d2 = dot(delta, delta);',
                '    float glow = exp(-d2 * 1.4) * uLightStrength;',
                '    float alpha = texel.a * (0.13 + 0.11 * pulse) + glow * 0.85;',
                '    vec3 col = texel.rgb * (1.0 + glow * 1.35);',
                '    gl_FragColor = vec4(col * alpha, 1.0);',
                '}'
            ].join('\n'),
            transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide
        });
        circuitTraceMesh = new THREE.Mesh(new THREE.PlaneGeometry(bw + 0.2, bh + 0.2), circuitTraceMat);
        circuitTraceMesh.rotation.x = -Math.PI / 2;
        circuitTraceMesh.position.y = 0.004;
        circuitTraceMesh.renderOrder = 2;
    } else {
        if (circuitTraceMesh.geometry) circuitTraceMesh.geometry.dispose();
        circuitTraceMesh.geometry = new THREE.PlaneGeometry(bw + 0.2, bh + 0.2);
    }
    boardGroup.add(circuitTraceMesh);
}
function updateCircuitTrace() {
    if (!circuitTraceMat || !circuitTraceMat.uniforms) return;
    var u = circuitTraceMat.uniforms;
    var now = performance.now() * 0.001;
    circuitPulse = now;
    if (u.uTime) u.uTime.value = now;
    if (u.uOffset) {
        u.uOffset.value.y = (u.uOffset.value.y + 0.0015) % 1;
        u.uOffset.value.x = (u.uOffset.value.x + 0.0006) % 1;
    }
    if (u.uLightPos && u.uLightStrength) {
        if (dynamicLight && dynamicLight.visible) {
            u.uLightPos.value.set(dynamicLight.position.x, 0, dynamicLight.position.z);
            u.uLightStrength.value = Math.min(1, dynamicLight.intensity / 1.2);
        } else {
            u.uLightStrength.value *= 0.9;
            if (u.uLightStrength.value < 0.01) u.uLightStrength.value = 0;
        }
    }
}

// ── Neon magenta energy aura around active / controlled dice ──
function initAura() {
    if (auraPoints) return;
    var positions = new Float32Array(AURA_MAX_PARTICLES * 3);
    var colors = new Float32Array(AURA_MAX_PARTICLES * 3);
    var geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    var mat = new THREE.PointsMaterial({
        size: 0.45, vertexColors: true, transparent: true, opacity: 1.0,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, sizeAttenuation: true
    });
    auraPoints = new THREE.Points(geom, mat);
    auraPoints.renderOrder = 6;
    auraPoints.visible = false;
    var parts = [];
    for (var i = 0; i < AURA_MAX_PARTICLES; i++) parts.push({ life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0 });
    auraPoints.userData.particles = parts;
    scene.add(auraPoints);
}
function emitAura(pos) {
    if (!auraPoints) initAura();
    var parts = auraPoints.userData.particles;
    var positions = auraPoints.geometry.attributes.position;
    var colors = auraPoints.geometry.attributes.color;
    var spawned = 0;
    for (var i = 0; i < AURA_MAX_PARTICLES && spawned < 3; i++) {
        var p = parts[i];
        if (p.life > 0) continue;
        p.life = 1; p.maxLife = 26 + Math.floor(Math.random() * 16);
        var ang = Math.random() * Math.PI * 2;
        var sp = 0.05 + Math.random() * 0.09;
        p.vx = Math.cos(ang) * sp; p.vz = Math.sin(ang) * sp; p.vy = 0.02 + Math.random() * 0.06;
        positions.array[i * 3] = pos.x + (Math.random() - 0.5) * 0.16;
        positions.array[i * 3 + 1] = pos.y + (Math.random() - 0.5) * 0.16;
        positions.array[i * 3 + 2] = pos.z + (Math.random() - 0.5) * 0.16;
        colors.array[i * 3] = 1.0; colors.array[i * 3 + 1] = 0.18; colors.array[i * 3 + 2] = 0.84;
        spawned++;
    }
}
function updateAura() {
    if (!auraPoints) return;
    var parts = auraPoints.userData.particles;
    var positions = auraPoints.geometry.attributes.position;
    var colors = auraPoints.geometry.attributes.color;
    var anyAlive = false;
    for (var i = 0; i < AURA_MAX_PARTICLES; i++) {
        var p = parts[i];
        if (p.life <= 0) {
            colors.array[i * 3] = 0; colors.array[i * 3 + 1] = 0; colors.array[i * 3 + 2] = 0;
            continue;
        }
        p.life -= 1 / p.maxLife;
        positions.array[i * 3] += p.vx;
        positions.array[i * 3 + 1] += p.vy;
        positions.array[i * 3 + 2] += p.vz;
        p.vy -= 0.0004;
        var f = Math.max(0, p.life);
        colors.array[i * 3] = f; colors.array[i * 3 + 1] = 0.18 * f; colors.array[i * 3 + 2] = 0.84 * f;
        if (p.life > 0) anyAlive = true;
    }
    positions.needsUpdate = true; colors.needsUpdate = true;
    auraPoints.visible = anyAlive;
}
function updateAuraEmitter() {
    if (gameState !== 'playing') return;
    if (!auraPoints) initAura();
    var emitted = 0;
    for (var x = 0; x < GRID_COLS && emitted < 2; x++) {
        for (var y = 0; y < GRID_ROWS && emitted < 2; y++) {
            var d = grid[x] && grid[x][y];
            if (d && (d.state === 'rolling' || d.state === 'sliding') && d.pivotGroup) {
                emitAura(d.pivotGroup.position);
                emitted++;
            }
        }
    }
    if (emitted < 2 && inputState.curDie && inputState.curDie.pivotGroup) emitAura(inputState.curDie.pivotGroup.position);
}

// ── Dynamic magenta point light that follows the active/controlled die ──
function findTrackedDie() {
    var d;
    if (inputState && inputState.curDie && inputState.curDie.pivotGroup) return inputState.curDie;
    for (var x = 0; x < GRID_COLS; x++) for (var y = 0; y < GRID_ROWS; y++) {
        d = grid[x] && grid[x][y];
        if (d && d.pivotGroup && (d.state === 'rolling' || d.state === 'sliding')) return d;
    }
    return null;
}
function updateDynamicLight() {
    if (!dynamicLight) return;
    var target = (gameState === 'playing') ? findTrackedDie() : null;
    var desired = target ? 1 : 0;
    dynamicLightStrength += (desired - dynamicLightStrength) * 0.15;
    if (dynamicLightStrength < 0.01) dynamicLightStrength = 0;
    dynamicLight.visible = dynamicLightStrength > 0.02;
    if (target) {
        _dynTargetPos.set(target.pivotGroup.position.x, target.pivotGroup.position.y + 1.15, target.pivotGroup.position.z);
        dynamicLight.position.copy(_dynTargetPos);
    }
    dynamicLight.intensity = 1.2 * dynamicLightStrength;
}

// ── Glowing magenta particle trail behind active die movement ──
function initTrails() {
    if (trailPoints) return;
    var positions = new Float32Array(TRAIL_MAX_PARTICLES * 3);
    var colors = new Float32Array(TRAIL_MAX_PARTICLES * 3);
    var geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    var mat = new THREE.PointsMaterial({
        size: 0.13, vertexColors: true, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, sizeAttenuation: true
    });
    trailPoints = new THREE.Points(geom, mat);
    trailPoints.renderOrder = 5;
    trailPoints.visible = false;
    trailParts = {
        life: new Float32Array(TRAIL_MAX_PARTICLES),
        maxLife: new Float32Array(TRAIL_MAX_PARTICLES),
        vx: new Float32Array(TRAIL_MAX_PARTICLES),
        vy: new Float32Array(TRAIL_MAX_PARTICLES),
        vz: new Float32Array(TRAIL_MAX_PARTICLES)
    };
    trailHead = 0; trailLiveCount = 0;
    trailLastTime = performance.now();
    scene.add(trailPoints);
}
function emitTrailBurst(wx, wy, wz, count) {
    if (!trailPoints) initTrails();
    var pos = trailPoints.geometry.attributes.position;
    var col = trailPoints.geometry.attributes.color;
    for (var k = 0; k < count; k++) {
        var i = trailHead;
        trailHead = (trailHead + 1) % TRAIL_MAX_PARTICLES;
        if (trailParts.life[i] <= 0) trailLiveCount++;
        var ang = Math.random() * Math.PI * 2;
        var sp = 0.25 + Math.random() * 0.55;
        trailParts.vx[i] = Math.cos(ang) * sp;
        trailParts.vz[i] = Math.sin(ang) * sp;
        trailParts.vy[i] = 0.35 + Math.random() * 0.7;
        trailParts.life[i] = trailParts.maxLife[i] = 0.5 + Math.random() * 0.5;
        pos.array[i * 3] = wx + (Math.random() - 0.5) * 0.16;
        pos.array[i * 3 + 1] = wy + (Math.random() - 0.5) * 0.16;
        pos.array[i * 3 + 2] = wz + (Math.random() - 0.5) * 0.16;
        col.array[i * 3] = 1.0; col.array[i * 3 + 1] = 0.19; col.array[i * 3 + 2] = 0.84;
    }
    trailPoints.visible = true;
}
function updateTrails(dt) {
    if (!trailPoints || trailLiveCount <= 0) return;
    var pos = trailPoints.geometry.attributes.position;
    var col = trailPoints.geometry.attributes.color;
    for (var i = 0; i < TRAIL_MAX_PARTICLES; i++) {
        if (trailParts.life[i] <= 0) {
            if (col.array[i * 3] !== 0) {
                col.array[i * 3] = 0; col.array[i * 3 + 1] = 0; col.array[i * 3 + 2] = 0;
            }
            continue;
        }
        trailParts.life[i] -= dt;
        pos.array[i * 3] += trailParts.vx[i] * dt;
        pos.array[i * 3 + 1] += trailParts.vy[i] * dt;
        pos.array[i * 3 + 2] += trailParts.vz[i] * dt;
        trailParts.vy[i] -= 0.55 * dt;
        if (trailParts.life[i] <= 0) {
            trailParts.life[i] = 0;
            trailLiveCount--;
            col.array[i * 3] = 0; col.array[i * 3 + 1] = 0; col.array[i * 3 + 2] = 0;
        } else {
            var f = trailParts.life[i] / trailParts.maxLife[i];
            col.array[i * 3] = f; col.array[i * 3 + 1] = 0.19 * f; col.array[i * 3 + 2] = 0.84 * f;
        }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    trailPoints.visible = trailLiveCount > 0;
}
function updateTrailEmitter() {
    if (gameState !== 'playing') return;
    if (!trailPoints) initTrails();
    var emitted = 0;
    for (var x = 0; x < GRID_COLS && emitted < 4; x++) {
        for (var y = 0; y < GRID_ROWS && emitted < 4; y++) {
            var d = grid[x] && grid[x][y];
            if (!d || !d.pivotGroup) continue;
            var moving = d.state === 'rolling' || d.state === 'sliding';
            if (moving) {
                if (!d.wasMoving) {
                    d.wasMoving = true;
                    emitTrailBurst(d.pivotGroup.position.x, d.pivotGroup.position.y + 0.25, d.pivotGroup.position.z, 7);
                    emitted++;
                } else if (Math.random() < 0.45) {
                    emitTrailBurst(d.pivotGroup.position.x, d.pivotGroup.position.y + 0.15, d.pivotGroup.position.z, 1);
                    emitted++;
                }
            } else {
                d.wasMoving = false;
            }
        }
    }
    if (inputState.isHolding && inputState.curDie && inputState.curDie.pivotGroup) {
        emitTrailBurst(inputState.curDie.pivotGroup.position.x, inputState.curDie.pivotGroup.position.y + 0.15, inputState.curDie.pivotGroup.position.z, 1);
    }
}

function setBoardSize(sizeKey) { if (!BOARD_PRESETS[sizeKey]) return; var preset = BOARD_PRESETS[sizeKey]; boardSize = sizeKey; GRID_COLS = preset.cols; GRID_ROWS = preset.rows; totalCells = GRID_COLS * GRID_ROWS; grid = Array(GRID_COLS).fill(null).map(function() { return Array(GRID_ROWS).fill(null); }); buildBoard(); setupOrthoCamera(); resizeNebula(); }
function setPuzzleBoard(cols, rows) { GRID_COLS = cols; GRID_ROWS = rows; totalCells = GRID_COLS * GRID_ROWS; grid = Array(GRID_COLS).fill(null).map(function() { return Array(GRID_ROWS).fill(null); }); buildBoard(); setupOrthoCamera(); resizeNebula(); }
function restorePuzzleBoardPreset() { if (puzzleSavedBoardSize !== null) { setBoardSize(puzzleSavedBoardSize); puzzleSavedBoardSize = null; } }

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
            var points = targetVal * component.length * 100; battleAwardScore(points); AudioEngine.playMatch(); var midDie = component[Math.floor(component.length/2)], mwx = (midDie.gridX - (GRID_COLS - 1) / 2) * GRID_SPACING, mwz = (midDie.gridY - (GRID_ROWS - 1) / 2) * GRID_SPACING; spawnZenBurst(mwx, 0.2, mwz, ZEN_FIREWORK_COLORS[targetVal % ZEN_FIREWORK_COLORS.length]);
            createFloatingScore(component[0].gridX, component[0].gridY, '+' + points); triggerChainEvaluations(groupId, targetVal); } }
    checkOnesChaining();
}

function evaluateRollChain(rolledDie) { if (rolledDie.state !== 'normal') return; var rx = rolledDie.gridX, ry = rolledDie.gridY, rv = rolledDie.faces.top; var neighbors = [[rx + 1, ry], [rx - 1, ry], [rx, ry + 1], [rx, ry - 1]]; for (var ni = 0; ni < neighbors.length; ni++) { var nx = neighbors[ni][0], ny = neighbors[ni][1]; if (nx >= 0 && nx < GRID_COLS && ny >= 0 && ny < GRID_ROWS) { var nd = grid[nx][ny]; if (nd && nd.state === 'sinking') { var group = activeSinkingGroups.find(function(g) { return g.id === nd.sinkingGroup; }); if (group) { if (rv === group.diceValue && rv !== 1) { addDieToSinkingGroup(rolledDie, group); return; } else if (rv === 1) { addDieToSinkingGroup(rolledDie, group); return; } } } } } }

function addDieToSinkingGroup(die, group) { die.startSinking(group.id); group.diceList.push(die); group.lastActivity = Date.now(); group.diceList.forEach(function(d) { d.sinkingTimer = Date.now(); }); comboCount++; showComboBanner(); var comboPoints = comboCount * 250; battleAwardScore(comboPoints); battleFreezeOpponent(comboCount, group.diceValue); AudioEngine.playCombo(comboCount); var cwx = (die.gridX - (GRID_COLS - 1) / 2) * GRID_SPACING, cwz = (die.gridY - (GRID_ROWS - 1) / 2) * GRID_SPACING; spawnZenBurst(cwx, 0.4, cwz, ZEN_FIREWORK_COLORS[comboCount % ZEN_FIREWORK_COLORS.length]); if (comboCount >= 2) triggerComboFireworks(comboCount, cwx, cwz); createFloatingScore(die.gridX, die.gridY, 'COMBO +' + comboPoints); checkOnesChaining(); }

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
function onPointerMove(e) { if (gameState !== 'playing' || inputState.activePtrId !== e.pointerId) return; if (gameMode === 'battle' && Date.now() < battlePlayerFrozenUntil) return; var dx = e.clientX - inputState.sX, dy = e.clientY - inputState.sY, dist = Math.sqrt(dx * dx + dy * dy); if (dist < SWIPE_THRESHOLD && !inputState.isHolding) return; if (inputState.isHolding && inputState.curDie) { e.preventDefault(); inputState.hasMoved = true; var cell = getGridCellFromPointer(e.clientX, e.clientY); if (cell && (cell.gx !== inputState.lastGX || cell.gy !== inputState.lastGY)) { var gdx = cell.gx - inputState.lastGX, gdy = cell.gy - inputState.lastGY; var dir = null; if (gdx === 1 && gdy === 0) dir = 'east'; else if (gdx === -1 && gdy === 0) dir = 'west'; else if (gdx === 0 && gdy === 1) dir = 'south'; else if (gdx === 0 && gdy === -1) dir = 'north'; else if (gdx !== 0 || gdy !== 0) { if (Math.abs(gdx) >= Math.abs(gdy)) dir = gdx > 0 ? 'east' : 'west'; else dir = gdy > 0 ? 'south' : 'north'; } if (dir) { triggerSlide(inputState.curDie, dir); inputState.lastGX = cell.gx; inputState.lastGY = cell.gy; } } } else if (dist >= SWIPE_THRESHOLD) { if (inputState.holdTmr) { clearTimeout(inputState.holdTmr); inputState.holdTmr = null; } inputState.hasMoved = true; } }
function onPointerUp(e) { if (inputState.activePtrId !== e.pointerId) return; if (inputState.holdTmr) { clearTimeout(inputState.holdTmr); inputState.holdTmr = null; } var dx = e.clientX - inputState.sX, dy = e.clientY - inputState.sY, dist = Math.sqrt(dx * dx + dy * dy), elapsed = Date.now() - inputState.sT; if (inputState.curDie) inputState.curDie.setHover(false); if (!inputState.isHolding && inputState.hasMoved && dist >= SWIPE_THRESHOLD && elapsed < HOLD_THRESHOLD) { if (gameMode !== 'battle' || Date.now() >= battlePlayerFrozenUntil) { var dir = getSwipeDirection(inputState.sX, inputState.sY, e.clientX, e.clientY); if (inputState.curDie && inputState.curDie.state === 'normal') triggerRoll(inputState.curDie, dir); } } hideGestureHint(); inputState.activePtrId = null; inputState.curDie = null; inputState.isHolding = false; inputState.hasMoved = false; }
function raycastDie(cx, cy) { var rect = renderer.domElement.getBoundingClientRect(), mx = ((cx - rect.left) / rect.width) * 2 - 1, my = -((cy - rect.top) / rect.height) * 2 + 1; var rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(mx, my), camera); var hits = rc.intersectObjects(diceGroup.children, true); if (hits.length > 0) { var obj = hits[0].object; while (obj && !obj.userData.die) obj = obj.parent; if (obj && obj.userData.die) return obj.userData.die; } return null; }
function getSwipeDirection(sx, sy, ex, ey) { function projectToGridPlane(cx, cy) { var rect = renderer.domElement.getBoundingClientRect(), mx = ((cx - rect.left) / rect.width) * 2 - 1, my = -((cy - rect.top) / rect.height) * 2 + 1; var rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(mx, my), camera); var plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); var pt = new THREE.Vector3(); if (rc.ray.intersectPlane(plane, pt)) return pt; return null; } var p1 = projectToGridPlane(sx, sy), p2 = projectToGridPlane(ex, ey); if (p1 && p2) { var gdx = p2.x - p1.x, gdz = p2.z - p1.z; if (gdx !== 0 && Math.abs(gdx) >= Math.abs(gdz)) return gdx > 0 ? 'east' : 'west'; if (gdz !== 0) return gdz > 0 ? 'south' : 'north'; } var dx = ex - sx, dy = ey - sy, ang = Math.atan2(dy, dx), deg = ang * (180 / Math.PI); if (deg < 0) deg += 360; if (deg >= 0 && deg < 90) return "east"; if (deg >= 90 && deg < 180) return "south"; if (deg >= 180 && deg < 270) return "west"; return "north"; }
function getGridCellFromPointer(cx, cy) { var rect = renderer.domElement.getBoundingClientRect(), mx = ((cx - rect.left) / rect.width) * 2 - 1, my = -((cy - rect.top) / rect.height) * 2 + 1; var rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(mx, my), camera); var plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); var pt = new THREE.Vector3(); if (rc.ray.intersectPlane(plane, pt)) { var gx = Math.round(pt.x / GRID_SPACING + (GRID_COLS - 1) / 2), gy = Math.round(pt.z / GRID_SPACING + (GRID_ROWS - 1) / 2); if (gx >= 0 && gx < GRID_COLS && gy >= 0 && gy < GRID_ROWS) return { gx: gx, gy: gy }; } return null; }
function triggerRoll(die, dir) { animationLock = true; var turn = gameMode === 'battle' ? 'player' : null; battleCurrentTurn = turn; die.roll(dir, function(moved) { battleCurrentTurn = turn; evaluateRollChain(die); checkAllMatches(); animationLock = false; if (gameMode === 'battle') battleCurrentTurn = null; if (gameMode === 'puzzle' && moved) decrementPuzzleMove(); }); }
function triggerSlide(die, dir) { animationLock = true; var turn = gameMode === 'battle' ? 'player' : null; battleCurrentTurn = turn; die.slide(dir, function(moved) { battleCurrentTurn = turn; evaluateRollChain(die); checkAllMatches(); animationLock = false; if (gameMode === 'battle') battleCurrentTurn = null; if (gameMode === 'puzzle' && moved) decrementPuzzleMove(); }); }
function handleKeyboard(e) { if (gameState !== 'playing') return; if (gameMode === 'battle' && Date.now() < battlePlayerFrozenUntil) return; var k = e.key.toLowerCase(); if (k === 'p' || k === 'escape') { pauseGame(); return; } var dir = null; if (k === 'arrowup' || k === 'w') dir = 'north'; else if (k === 'arrowdown' || k === 's') dir = 'south'; else if (k === 'arrowleft' || k === 'a') dir = 'west'; else if (k === 'arrowright' || k === 'd') dir = 'east'; else return; var die = findRollableDie(); if (die) triggerRoll(die, dir); }
function findRollableDie() { var cx = Math.floor(GRID_COLS / 2), cy = Math.floor(GRID_ROWS / 2); for (var r = 0; r < Math.max(GRID_COLS, GRID_ROWS); r++) for (var dx = -r; dx <= r; dx++) for (var dy = -r; dy <= r; dy++) { if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; var x = cx + dx, y = cy + dy; if (x >= 0 && x < GRID_COLS && y >= 0 && y < GRID_ROWS) { var die = grid[x][y]; if (die && die.state === 'normal' && die.cellType === CELL_TYPE.ACTIVE) return die; } } return null; }
function showGestureHint(txt) { var h = document.getElementById('gesture-hint'); document.getElementById('hint-text').innerText = txt; h.classList.remove('gesture-hide'); }
function hideGestureHint() { document.getElementById('gesture-hint').classList.add('gesture-hide'); }

function startGame(mode) { AudioEngine.stopMenuMusic(); mode = mode || 'zen'; AudioEngine.init(); gameState = 'playing'; gameMode = mode; score = 0; comboCount = 0; animationLock = false; hideAiMoveMarker(); updateScoreDisplay(); hideComboBanner(); hideGestureHint(); initStardust(); initAura(); initTrails(); document.getElementById('menu-screen').classList.remove('active'); document.getElementById('puzzle-select-screen').classList.remove('active'); document.getElementById('pause-screen').classList.remove('active'); document.getElementById('gameover-screen').classList.remove('active'); document.getElementById('hud-screen').classList.add('active'); document.getElementById('puzzle-hud').style.display = (mode === 'puzzle') ? 'flex' : 'none'; document.getElementById('battle-hud').style.display = (mode === 'battle') ? 'flex' : 'none'; document.getElementById('hud-screen').classList.toggle('hide-highscore', mode === 'battle'); document.getElementById('battle-timer-box').style.display = (mode === 'battle') ? 'block' : 'none'; if (mode === 'puzzle') setupPuzzleMode(); else if (mode === 'battle') setupBattleMode();    else { populateInitialBoard(); startSpawning(); initZenEffects(); } AudioEngine.startBGM(mode); updateFullnessBar(countActiveDice() / totalCells); }
function startSpawning() { stopSpawning(); spawnTimerId = setTimeout(spawnRandomDie, DIFFICULTY_SETTINGS[selectedDifficulty].spawnInterval); }
function pauseGame() { if (gameState !== 'playing') return; gameState = 'paused'; stopSpawning(); AudioEngine.stopBGM(); document.getElementById('hud-screen').classList.remove('active'); document.getElementById('pause-screen').classList.add('active'); }
function resumeGame() { if (gameState !== 'paused') return; gameState = 'playing'; document.getElementById('pause-screen').classList.remove('active'); document.getElementById('hud-screen').classList.add('active'); if (gameMode !== 'puzzle') startSpawning(); AudioEngine.startBGM(gameMode); }
function quitToMenu() { gameState = 'menu'; hideAiMoveMarker(); clearZenEffects(); AudioEngine.startMenuMusic(); stopSpawning(); if (gameMode === 'battle') { stopAITicks(); stopBattleTimer(); } document.getElementById('pause-screen').classList.remove('active'); document.getElementById('gameover-screen').classList.remove('active'); document.getElementById('hud-screen').classList.remove('active'); document.getElementById('hud-screen').classList.remove('hide-highscore'); document.getElementById('battle-timer-box').style.display = 'none'; document.getElementById('menu-screen').classList.add('active'); document.getElementById('menu-highscore').innerText = Number(highScore).toLocaleString(); clearAllDice(); if (gameMode === 'puzzle') restorePuzzleBoardPreset(); }
function clearAllDice() { for (var x = 0; x < GRID_COLS; x++) for (var y = 0; y < GRID_ROWS; y++) { if (grid[x] && grid[x][y]) { diceGroup.remove(grid[x][y].pivotGroup); grid[x][y].mesh.geometry.dispose(); } if (sinkingHighlights[x] && sinkingHighlights[x][y]) sinkingHighlights[x][y].visible = false; } grid = Array(GRID_COLS).fill(null).map(function() { return Array(GRID_ROWS).fill(null); }); activeSinkingGroups = []; }

// ── Zen mode background effects (Tetris Effect style fireworks) ──
function initZenEffects() {
    // Ambient floating particle field behind the board
    if (zenAmbientParticles) {
        worldGroup.remove(zenAmbientParticles);
        zenAmbientParticles.geometry.dispose();
        zenAmbientParticles.material.dispose();
        zenAmbientParticles = null;
    }
    var positions = new Float32Array(ZEN_AMBIENT_COUNT * 3);
    var colors = new Float32Array(ZEN_AMBIENT_COUNT * 3);
    for (var i = 0; i < ZEN_AMBIENT_COUNT; i++) {
        positions[i*3] = (Math.random() - 0.5) * 24;
        positions[i*3+1] = (Math.random() - 0.3) * 16;
        positions[i*3+2] = -0.9 - Math.random() * 3;
        // 15% white-hot embers make the ambient field brighter and punchier
        var pc;
        if (Math.random() < 0.15) {
            pc = new THREE.Color(1, 1, 1);
        } else {
            pc = new THREE.Color(ZEN_FIREWORK_COLORS[Math.floor(Math.random() * ZEN_FIREWORK_COLORS.length)]);
        }
        colors[i*3] = pc.r; colors[i*3+1] = pc.g; colors[i*3+2] = pc.b;
    }
    var geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    var mat = new THREE.PointsMaterial({
        size: 0.5, vertexColors: true, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, sizeAttenuation: true
    });
    zenAmbientParticles = new THREE.Points(geom, mat);
    worldGroup.add(zenAmbientParticles);
    var vel = [], tw = [];
    for (var j = 0; j < ZEN_AMBIENT_COUNT; j++) {
        vel.push({
            vx: (Math.random() - 0.5) * 0.004,
            vy: 0.004 + Math.random() * 0.008,
            phase: Math.random() * Math.PI * 2
        });
        tw.push({
            phase: Math.random() * Math.PI * 2,
            speed: 0.015 + Math.random() * 0.035,
            base: 0.55 + Math.random() * 0.45
        });
    }
    zenAmbientParticles.userData.velocities = vel;
    zenAmbientParticles.userData.twinkles = tw;
    zenAmbientParticles.userData.baseColors = new Float32Array(colors);
    // Clean up old bursts from previous sessions
    zenFireworkBursts.forEach(function(m) { worldGroup.remove(m); m.geometry.dispose(); m.material.dispose(); });
    zenFireworkBursts = [];
    zenAmbientPulse = 0;
    startZenFireworks();
}

function startZenFireworks() {
    stopZenFireworks();
    // In seeded (playtester) mode, delay the first burst so regression
    // screenshots are captured against a clean background, but keep the
    // delay short enough that background fireworks appear during live play.
    var seeded = /[?&]seed=/.test(window.location.search);
    var firstDelay = seeded ? 5000 : 400 + Math.random() * 700;
    zenFireworkTimerId = setTimeout(function tick() {
        if (gameMode === 'zen' && gameState === 'playing') {
            spawnZenBurst();
            // Salvo: occasionally fire 2-4 bursts at once for a
            // screen-filling, rhythmic celebration.
            if (Math.random() < 0.45) scheduleZenSalvo(120 + Math.random() * 250);
            if (Math.random() < 0.22) scheduleZenSalvo(250 + Math.random() * 300);
            if (Math.random() < 0.1) scheduleZenSalvo(350 + Math.random() * 400);
        }
        // Always reschedule so fireworks resume after a pause.
        zenFireworkTimerId = setTimeout(tick, 800 + Math.random() * 1000);
    }, firstDelay);
}

function scheduleZenSalvo(delay) {
    zenFireworkTimeouts.push(setTimeout(function() {
        if (gameMode === 'zen' && gameState === 'playing' && worldGroup) spawnZenBurst();
    }, delay));
}

function stopZenFireworks() {
    if (zenFireworkTimerId) { clearTimeout(zenFireworkTimerId); zenFireworkTimerId = null; }
    zenFireworkTimeouts.forEach(function(id) { clearTimeout(id); });
    zenFireworkTimeouts = [];
}

function pickZenBurstType() {
    var r = Math.random();
    if (r < 0.3) return 'peony';
    if (r < 0.5) return 'ring';
    if (r < 0.75) return 'willow';
    return 'double';
}

function spawnZenBurst(posX, posY, posZ, forceColor, forceType, sizeMult) {
    if (gameMode !== 'zen' || !worldGroup) return;
    if (zenFireworkBursts.length > 24) return; // safety cap keeps 60 FPS
    var bx = (typeof posX !== 'undefined') ? posX : (Math.random() - 0.5) * 15;
    var by = (typeof posY !== 'undefined') ? posY : (Math.random() - 0.5) * 8;
    var bz = (typeof posZ !== 'undefined') ? posZ : -0.4 - Math.random() * 1.2;
    var type = (typeof forceType === 'undefined' || forceType === null) ? pickZenBurstType() : forceType;
    var mult = (typeof sizeMult === 'undefined' || sizeMult === null) ? 1 : sizeMult;
    var dualColor = (typeof forceColor === 'undefined' || forceColor === null) && Math.random() < 0.3;
    var color = forceColor || ZEN_FIREWORK_COLORS[Math.floor(Math.random() * ZEN_FIREWORK_COLORS.length)];
    var color2 = ZEN_FIREWORK_COLORS[Math.floor(Math.random() * ZEN_FIREWORK_COLORS.length)];
    if (!dualColor) color2 = color;

    var count, speedMin, speedMax, maxLifeMin, maxLifeMax, drag, gravity, matSize;
    if (type === 'ring') {
        count = 70 + Math.floor(Math.random() * 30);
        speedMin = 0.10; speedMax = 0.20;
        maxLifeMin = 70; maxLifeMax = 110;
        drag = 0.965; gravity = 0; matSize = 1.0;
    } else if (type === 'willow') {
        count = 45 + Math.floor(Math.random() * 20);
        speedMin = 0.02; speedMax = 0.06;
        maxLifeMin = 230; maxLifeMax = 300;
        drag = 0.995; gravity = -0.0025; matSize = 1.1;
    } else if (type === 'flash') {
        count = 100 + Math.floor(Math.random() * 40);
        speedMin = 0.12; speedMax = 0.28;
        maxLifeMin = 45; maxLifeMax = 70;
        drag = 0.955; gravity = 0.008; matSize = 1.35;
    } else { // peony / double-break base
        count = 75 + Math.floor(Math.random() * 45);
        speedMin = 0.05; speedMax = 0.16;
        maxLifeMin = 80; maxLifeMax = 130;
        drag = 0.962; gravity = 0.004; matSize = 1.0;
    }
    var ringRadius = (type === 'ring' ? (1.8 + Math.random() * 0.9) : 0) * Math.min(3.0, mult);

    var positions = new Float32Array(count * 3);
    var colors = new Float32Array(count * 3);
    var velocities = [];
    var baseC = new THREE.Color(color);
    var baseC2 = new THREE.Color(color2);
    for (var i = 0; i < count; i++) {
        positions[i*3] = bx; positions[i*3+1] = by; positions[i*3+2] = bz;
        var brightness = 0.5 + Math.random() * 0.5;
        var pc;
        if (Math.random() < 0.15) { // ~15% white-hot core sparks for pop
            pc = new THREE.Color(1, 1, 1);
        } else if (dualColor && Math.random() < 0.5) {
            pc = baseC2.clone().multiplyScalar(brightness);
        } else {
            pc = baseC.clone().multiplyScalar(brightness);
        }
        colors[i*3] = pc.r; colors[i*3+1] = pc.g; colors[i*3+2] = pc.b;
        var vx = 0, vy = 0, vz = 0;
        if (type === 'ring') {
            // Expanding halo: particles start on the ring and fly outward
            var ang = Math.random() * Math.PI * 2;
            var radius = ringRadius * (0.85 + Math.random() * 0.3);
            var speed = speedMin + Math.random() * (speedMax - speedMin);
            positions[i*3] = bx + Math.cos(ang) * radius;
            positions[i*3+1] = by + (Math.random() - 0.5) * 0.12;
            positions[i*3+2] = bz + Math.sin(ang) * radius;
            vx = Math.cos(ang) * speed;
            vy = (Math.random() - 0.5) * speed * 0.25;
            vz = Math.sin(ang) * speed;
        } else {
            var angleH = Math.random() * Math.PI * 2;
            var angleV = (Math.random() - 0.5) * Math.PI * 0.8;
            var speed = speedMin + Math.random() * (speedMax - speedMin);
            vx = Math.cos(angleH) * Math.cos(angleV) * speed;
            vy = Math.sin(angleV) * speed + 0.02;
            vz = Math.sin(angleH) * Math.cos(angleV) * speed;
        }
        velocities.push({ vx: vx, vy: vy, vz: vz });
    }
    if (type === 'double') {
        // Double-break: a second, differently colored burst pops moments later
        var secondColor = ZEN_FIREWORK_COLORS[Math.floor(Math.random() * ZEN_FIREWORK_COLORS.length)];
        var breakDelay = 300 + Math.random() * 250;
        zenFireworkTimeouts.push(setTimeout(function() {
            if (gameMode !== 'zen' || gameState !== 'playing' || !worldGroup) return;
            spawnZenBurst(
                bx + (Math.random() - 0.5) * 1.2,
                by + 0.4 + Math.random() * 0.9,
                bz,
                secondColor,
                Math.random() < 0.5 ? 'ring' : 'peony',
                mult
            );
        }, breakDelay));
    }
    var geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    var mat = new THREE.PointsMaterial({
        size: matSize * mult, vertexColors: true, transparent: true, opacity: 1.0,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, sizeAttenuation: true
    });
    var mesh = new THREE.Points(geom, mat);
    mesh.userData.velocities = velocities;
    mesh.userData.drag = drag;
    mesh.userData.gravity = gravity;
    mesh.userData.age = 0;
    mesh.userData.maxAge = Math.round(maxLifeMin + Math.random() * (maxLifeMax - maxLifeMin));
    worldGroup.add(mesh);
    zenFireworkBursts.push(mesh);
}

// Combo dopamine hook: bigger combos = bigger, brighter, more numerous bursts
// plus a screen-scale flash, a wide halo, and an ambient brightness pulse.
function triggerComboFireworks(combo, wx, wz) {
    if (gameMode !== 'zen' || !worldGroup) return;
    var tier = Math.min(combo, 8);
    var mult = 1 + tier * 0.12;
    var extra = Math.min(2 + tier, 8);
    // Screen-scale flash + halo right at the match point
    spawnZenBurst(wx, 1.0, wz, 0xffffff, 'flash', Math.min(2.6, mult * 1.2));
    spawnZenBurst(wx, 1.3, wz, null, 'ring', Math.min(2.8, mult));
    var types = ['peony', 'ring', 'willow', 'double'];
    for (var i = 0; i < extra; i++) {
        (function(idx) {
            var delay = 60 + idx * 100;
            zenFireworkTimeouts.push(setTimeout(function() {
                if (gameMode !== 'zen' || gameState !== 'playing' || !worldGroup) return;
                spawnZenBurst(
                    wx + (Math.random() - 0.5) * 8,
                    0.3 + Math.random() * 3.5,
                    wz + (Math.random() - 0.5) * 3,
                    null,
                    types[idx % types.length],
                    mult
                );
            }, delay));
        })(i);
    }
    zenAmbientPulse = Math.min(1, 0.35 + combo * 0.12);
}

function clearZenEffects() {
    stopZenFireworks();
    if (zenAmbientParticles) {
        worldGroup.remove(zenAmbientParticles);
        zenAmbientParticles.geometry.dispose();
        zenAmbientParticles.material.dispose();
        zenAmbientParticles = null;
    }
    if (stardustPoints) {
        scene.remove(stardustPoints);
        stardustPoints.geometry.dispose();
        stardustPoints.material.dispose();
        stardustPoints = null;
    }
    if (trailPoints) {
        scene.remove(trailPoints);
        trailPoints.geometry.dispose();
        trailPoints.material.dispose();
        trailPoints = null;
        trailParts = null;
        trailHead = 0;
        trailLiveCount = 0;
    }
    if (auraPoints) {
        scene.remove(auraPoints);
        auraPoints.geometry.dispose();
        auraPoints.material.dispose();
        auraPoints = null;
    }
    zenFireworkBursts.forEach(function(m) {
        worldGroup.remove(m);
        m.geometry.dispose();
        m.material.dispose();
    });
    zenFireworkBursts = [];
    zenAmbientPulse = 0;
}

function updateZenEffects() {
    // Update ambient particle float + twinkle
    if (zenAmbientParticles) {
        var pos = zenAmbientParticles.geometry.attributes.position;
        var vel = zenAmbientParticles.userData.velocities;
        var col = zenAmbientParticles.geometry.attributes.color;
        var tw = zenAmbientParticles.userData.twinkles;
        var base = zenAmbientParticles.userData.baseColors;
        if (pos && vel) {
            for (var i = 0; i < ZEN_AMBIENT_COUNT && i < vel.length; i++) {
                pos.array[i*3] += vel[i].vx;
                pos.array[i*3+1] += vel[i].vy;
                pos.array[i*3+2] += Math.sin(zenAmbientPhase + vel[i].phase) * 0.0012;
                // Wrap to bottom when reaching top
                if (pos.array[i*3+1] > 10) {
                    pos.array[i*3] = (Math.random() - 0.5) * 24;
                    pos.array[i*3+1] = -6;
                    pos.array[i*3+2] = -0.9 - Math.random() * 3;
                }
            }
            pos.needsUpdate = true;
        }
        if (col && tw && base) {
            var pulse = 1 + zenAmbientPulse;
            for (var t = 0; t < ZEN_AMBIENT_COUNT && t < tw.length; t++) {
                tw[t].phase += tw[t].speed;
                var b = tw[t].base * (0.7 + 0.3 * Math.sin(tw[t].phase)) * pulse;
                col.array[t*3] = base[t*3] * b;
                col.array[t*3+1] = base[t*3+1] * b;
                col.array[t*3+2] = base[t*3+2] * b;
            }
            col.needsUpdate = true;
        }
        zenAmbientParticles.material.opacity = Math.min(1, 0.85 + zenAmbientPulse * 0.15);
    }
    zenAmbientPhase += 0.015;
    if (zenAmbientPulse > 0) {
        zenAmbientPulse *= 0.94;
        if (zenAmbientPulse < 0.01) zenAmbientPulse = 0;
    }

    // Update firework bursts
    for (var i = zenFireworkBursts.length - 1; i >= 0; i--) {
        var burst = zenFireworkBursts[i];
        burst.userData.age++;
        var progress = burst.userData.age / burst.userData.maxAge;
        var pos = burst.geometry.attributes.position;
        var vel = burst.userData.velocities;
        var col = burst.geometry.attributes.color;
        var drag = burst.userData.drag || 0.965;
        var grav = burst.userData.gravity || 0;
        if (pos && vel) {
            for (var j = 0; j < vel.length && j * 3 < pos.array.length; j++) {
                pos.array[j*3] += vel[j].vx;
                pos.array[j*3+1] += vel[j].vy;
                pos.array[j*3+2] += vel[j].vz;
                vel[j].vx *= drag;
                vel[j].vy = vel[j].vy * drag + grav;
                vel[j].vz *= drag;
            }
            pos.needsUpdate = true;
            if (col && col.array) {
                for (var k = 0; k < col.array.length; k++) col.array[k] *= 0.985;
                col.needsUpdate = true;
            }
        }
        burst.material.opacity = Math.max(0, 1 - progress * 1.05);
        if (progress >= 1) {
            worldGroup.remove(burst);
            burst.geometry.dispose();
            burst.material.dispose();
            zenFireworkBursts.splice(i, 1);
        }
    }
}
function triggerGameOver() { AudioEngine.stopMenuMusic(); hideAiMoveMarker(); clearZenEffects(); gameState = 'gameover'; stopSpawning(); AudioEngine.stopBGM(); if (gameMode === 'puzzle') { clearAllDice(); restorePuzzleBoardPreset(); } var isBattle = gameMode === 'battle', playerWon = battlePlayerScore >= battleAiScore; var won = (isBattle && playerWon) || (gameMode === 'puzzle' && puzzleCleared); if (won) AudioEngine.playVictory(); else AudioEngine.playDefeat(); if (gameMode === 'battle') { stopAITicks(); stopBattleTimer(); } var isNewHigh = false; if (gameMode !== 'battle' && score > highScore) { highScore = score; localStorage.setItem('dicefall_zen_hs', highScore); isNewHigh = true; } document.getElementById('go-score').innerText = (gameMode === 'battle' ? battlePlayerScore : score).toLocaleString(); document.getElementById('go-combo').innerText = comboCount.toString(); document.getElementById('new-high-indicator').style.display = isNewHigh ? 'block' : 'none'; var titleEl = document.getElementById('gameover-title-text'); if (gameMode === 'puzzle') titleEl.innerText = puzzleCleared ? 'ALL PUZZLES CLEARED!' : 'OUT OF MOVES!'; else if (isBattle) titleEl.innerText = playerWon ? 'YOU WIN!' : 'YOU LOSE!'; else titleEl.innerText = 'BOARD FILLED!'; document.getElementById('battle-go-stats').style.display = isBattle ? '' : 'none'; if (isBattle) { document.getElementById('go-player-score').innerText = battlePlayerScore.toLocaleString(); document.getElementById('go-ai-score').innerText = battleAiScore.toLocaleString(); var pr = document.getElementById('go-player-row'), ar = document.getElementById('go-ai-row'); if (playerWon) { pr.classList.add('winner'); ar.classList.remove('winner'); } else { ar.classList.add('winner'); pr.classList.remove('winner'); } } else { document.getElementById('go-player-row').classList.remove('winner'); document.getElementById('go-ai-row').classList.remove('winner'); } document.getElementById('hud-screen').classList.remove('active'); document.getElementById('gameover-screen').classList.add('active'); document.getElementById('battle-timer-box').style.display = 'none'; }

function setupPuzzleMode() {
    if (typeof window._puzzleChosenStage === 'number') puzzleStage = window._puzzleChosenStage;
    else puzzleStage = Math.min(puzzleProgress + 1, puzzleMaxStages);
    window._puzzleChosenStage = null;
    puzzleSavedBoardSize = boardSize;
    setupPuzzleStage();
}
function setupPuzzleStage() {
    clearAllDice(); puzzleCleared = false;
    var stageDef = PUZZLE_STAGES[puzzleStage - 1];
    puzzleMovesRemaining = stageDef.moves;
    document.getElementById('hud-moves').innerText = String(puzzleMovesRemaining).padStart(2, '0');
    document.getElementById('puzzle-stage').innerText = 'STAGE ' + puzzleStage + '/' + puzzleMaxStages;
    setPuzzleBoard(stageDef.board.cols, stageDef.board.rows);
    stageDef.walls.forEach(function(w) {
        if (w.x >= 0 && w.x < GRID_COLS && w.y >= 0 && w.y < GRID_ROWS && !grid[w.x][w.y]) {
            grid[w.x][w.y] = new Die(w.x, w.y, 0, CELL_TYPE.LOCKED);
        }
    });
    stageDef.dice.forEach(function(item) {
        if (item.x >= 0 && item.x < GRID_COLS && item.y >= 0 && item.y < GRID_ROWS && !grid[item.x][item.y]) {
            var d = new Die(item.x, item.y, item.v, undefined, item.rot);
            d.state = 'normal'; d.height = 0;
            d.mesh.material = getDiceMaterials(d.faces, 'normal');
            d.updateMeshPosition();
            grid[item.x][item.y] = d;
        }
    });
    updateFullnessBar(countActiveDice() / totalCells);
}
function decrementPuzzleMove() {
    puzzleMovesRemaining--;
    document.getElementById('hud-moves').innerText = String(Math.max(0, puzzleMovesRemaining)).padStart(2, '0');
    if (countPuzzleRemaining() === 0) {
        puzzleCleared = true;
        AudioEngine.playVictory();
        score += puzzleMovesRemaining * 500 + puzzleStage * 1000;
        updateScoreDisplay();
        if (puzzleStage > puzzleProgress) {
            puzzleProgress = puzzleStage;
            localStorage.setItem('dicefall_puzzle_progress', String(puzzleProgress));
        }
        if (puzzleStage >= puzzleMaxStages) {
            triggerGameOver();
        } else {
            puzzleStage++;
            showStageClearBanner();
            setTimeout(function() { hideStageClearBanner(); setupPuzzleStage(); AudioEngine.startBGM('puzzle'); }, 2200);
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
function startAITicks() { stopAITicks(); var rates = { easy: 1200, medium: 800, hard: 500 }, interval = rates[aiDifficulty] || 800; aiTickInterval = setInterval(function() { if (gameState !== 'playing' || gameMode !== 'battle') return; if (Date.now() < battleAiFrozenUntil || animationLock) return; var bestMove = aiFindBestMove(); if (bestMove) { var turn = 'ai'; battleCurrentTurn = turn; var die = bestMove.die, dir = bestMove.direction, isRoll = bestMove.isRoll; showAiMoveMarker(die); animationLock = true; if (isRoll) die.roll(dir, function() {}); else die.slide(dir, function() {}); var moved = die.state === 'rolling' || die.state === 'sliding'; setTimeout(function() { if (gameState === 'playing' && gameMode === 'battle' && moved) { battleCurrentTurn = turn; checkAllMatches(); } animationLock = false; if (gameMode === 'battle') battleCurrentTurn = null; }, ROLL_DURATION + 50); } }, interval); }
function aiFindBestMove() { var bestScore = -Infinity, bestMove = null; for (var x = 0; x < GRID_COLS; x++) for (var y = 0; y < GRID_ROWS; y++) { var die = grid[x][y]; if (!die || die.state !== 'normal' || die.cellType !== CELL_TYPE.ACTIVE) continue; var directions = ['north', 'south', 'east', 'west']; for (var di = 0; di < directions.length; di++) { var dir = directions[di], d = DIRECTIONS[dir], nx = x + d.dx, ny = y + d.dy; if (nx < 0 || nx >= GRID_COLS || ny < 0 || ny >= GRID_ROWS) continue; if (grid[nx][ny] === null) { var s = aiScoreMove(die, dir, true); if (s > bestScore) { bestScore = s; bestMove = { die: die, direction: dir, isRoll: true }; } var s2 = aiScoreMove(die, dir, false); if (s2 > bestScore) { bestScore = s2; bestMove = { die: die, direction: dir, isRoll: false }; } } } } return bestMove; }
function aiScoreMove(die, dir, isRoll) { var s = 0, d = DIRECTIONS[dir], tx = die.gridX + d.dx, ty = die.gridY + d.dy, cv = die.faces.top; for (var dx = -2; dx <= 2; dx++) for (var dy = -2; dy <= 2; dy++) { var sx = tx + dx, sy = ty + dy; if (sx >= 0 && sx < GRID_COLS && sy >= 0 && sy < GRID_ROWS) { var n = grid[sx][sy]; if (n && n.state === 'normal' && n.cellType === CELL_TYPE.ACTIVE) { if (n.faces.top === cv) s += 30; if (n.faces.top === 1) s += 15; } } } if (cv >= 3) s += cv * 10; for (var gi = 0; gi < activeSinkingGroups.length; gi++) { var group = activeSinkingGroups[gi]; for (var gdi = 0; gdi < group.diceList.length; gdi++) { var gd = group.diceList[gdi], dist = Math.abs(gd.gridX - tx) + Math.abs(gd.gridY - ty); if (dist <= 2) s += 20; } } return s + Math.random() * 10; }
function ensureAiMoveMarker() {
    if (aiMoveMarker) return aiMoveMarker;
    aiMoveMarker = new THREE.Group();
    var ring = new THREE.Mesh(
        new THREE.RingGeometry(0.7, 1.0, 48),
        new THREE.MeshBasicMaterial({ color: AI_MARKER_COLOR, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false, renderOrder: 3 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.025;
    var arrow = new THREE.Mesh(
        new THREE.ConeGeometry(0.2, 0.44, 4),
        new THREE.MeshBasicMaterial({ color: AI_MARKER_COLOR, transparent: true, opacity: 1.0, depthWrite: false })
    );
    arrow.rotation.x = Math.PI; // tip points down at the die
    arrow.position.y = 1.55;
    aiMoveMarker.add(ring);
    aiMoveMarker.add(arrow);
    aiMoveMarker.userData.ring = ring;
    aiMoveMarker.userData.arrow = arrow;
    aiMoveMarker.visible = false;
    worldGroup.add(aiMoveMarker);
    return aiMoveMarker;
}
function showAiMoveMarker(die) {
    var m = ensureAiMoveMarker();
    aiMarkerDie = die;
    aiMarkerUntil = Date.now() + AI_MARKER_DURATION;
    m.visible = true;
}
function hideAiMoveMarker() {
    if (aiMoveMarker) aiMoveMarker.visible = false;
    aiMarkerDie = null;
    aiMarkerUntil = 0;
}
function updateAiMoveMarker() {
    if (!aiMoveMarker || !aiMarkerDie) { if (aiMoveMarker) aiMoveMarker.visible = false; return; }
    var die = aiMarkerDie;
    if (gameMode !== 'battle' || Date.now() > aiMarkerUntil || !die.pivotGroup || !die.pivotGroup.parent) {
        aiMoveMarker.visible = false;
        aiMarkerDie = null;
        return;
    }
    aiMoveMarker.visible = true;
    aiMoveMarker.position.set(die.pivotGroup.position.x, 0, die.pivotGroup.position.z);
    var t = (Date.now() % 700) / 700, pulse = 1 + 0.12 * Math.sin(t * Math.PI * 2);
    var ring = aiMoveMarker.userData.ring, arrow = aiMoveMarker.userData.arrow;
    if (ring) { ring.scale.set(pulse, pulse, 1); ring.material.opacity = 0.72 + 0.23 * (1 - t); }
    if (arrow) arrow.position.y = 1.5 + Math.sin(t * Math.PI * 2) * 0.18;
}
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
function updateFullnessBar(pct) { pct = Math.min(pct * 100, 100); if (pct === lastFullnessPct) return; lastFullnessPct = pct; var bar = document.getElementById('capacity-bar'), warning = document.getElementById('capacity-warning'); bar.style.width = pct + '%'; if (pct >= 80) { warning.classList.add('danger-alarm'); bar.style.boxShadow = '0 0 10px #ff3366'; } else { warning.classList.remove('danger-alarm'); bar.style.boxShadow = 'none'; } }
var comboTmrId = null;
var lastFullnessPct = -1;
function showComboBanner() { var banner = document.getElementById('combo-display'); document.getElementById('combo-count').innerText = comboCount.toString(); banner.classList.remove('combo-hide'); if (comboTmrId) clearTimeout(comboTmrId); comboTmrId = setTimeout(function() { banner.classList.add('combo-hide'); }, 2500); }
function hideComboBanner() { document.getElementById('combo-display').classList.add('combo-hide'); }

function openPuzzleSelect() {
    var progress = puzzleProgress;
    var resumeStage = Math.min(progress + 1, puzzleMaxStages);
    var progressEl = document.getElementById('puzzle-select-progress');
    if (progress <= 0) progressEl.innerText = 'NO STAGES CLEARED YET';
    else if (progress >= puzzleMaxStages) progressEl.innerText = 'ALL 50 STAGES CLEARED!';
    else progressEl.innerText = 'STAGE ' + progress + ' CLEARED — RESUME AT STAGE ' + resumeStage;
    var resumeBtn = document.getElementById('puzzle-resume-btn');
    resumeBtn.innerText = 'RESUME STAGE ' + resumeStage;
    var gridEl = document.getElementById('puzzle-stage-grid');
    gridEl.innerHTML = '';
    for (var i = 1; i <= puzzleMaxStages; i++) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'puzzle-tile';
        if (i <= progress) btn.classList.add('solved');
        if (i === resumeStage) btn.classList.add('current');
        if (i > resumeStage) { btn.classList.add('locked'); btn.disabled = true; }
        btn.innerText = (i <= progress) ? (i + ' \u2713') : String(i);
        if (i <= resumeStage) {
            (function(n) { btn.addEventListener('click', function() { startPuzzleAt(n); }); })(i);
        }
        gridEl.appendChild(btn);
    }
    document.getElementById('menu-screen').classList.remove('active');
    document.getElementById('puzzle-select-screen').classList.add('active');
}
function startPuzzleAt(n) { window._puzzleChosenStage = n; startGame('puzzle'); }
function setupControlListeners() { window.addEventListener('keydown', handleKeyboard); setupPointerEvents(); var audioUnlockDone = false; function unlockAudio() { if (audioUnlockDone) return; audioUnlockDone = true; function startMusic() { if (!musicEnabled) return; if (gameState === 'menu') AudioEngine.startMenuMusic(); else if (gameState === 'playing') AudioEngine.startBGM(gameMode); } /* 1) Synchronous attempt FIRST: Firefox/Safari need play() inside the user-gesture task (an async resume().then() loses the gesture context there). Chrome may resolve it silently while suspended — the resume().then() below re-plays with the ctx running. */ try { startMusic(); } catch (e) { /* silent */ } /* 2) Then resume the context (Chrome's requirement) and retry once it is running. Covers 'suspended' AND 'interrupted' (Chrome Android backgrounding). */ try { if (audioCtx && audioCtx.state !== 'running') { var p = audioCtx.resume(); if (p && p.then) { p.then(startMusic).catch(function() { setTimeout(startMusic, 250); }); } } } catch (e) { try { setTimeout(startMusic, 250); } catch (e2) { /* silent */ } } } window.addEventListener('pointerdown', unlockAudio); window.addEventListener('keydown', unlockAudio); window.addEventListener('touchstart', unlockAudio); window.addEventListener('pointerup', unlockAudio); window.addEventListener('click', unlockAudio); window.addEventListener('mousedown', unlockAudio); document.getElementById('sound-toggle').checked = soundEnabled; document.getElementById('music-toggle').checked = musicEnabled; document.getElementById('sound-toggle').addEventListener('change', function() { soundEnabled = this.checked; }); document.getElementById('music-toggle').addEventListener('change', function() { musicEnabled = this.checked; if (musicEnabled) { if (gameState === 'menu') AudioEngine.startMenuMusic(); else AudioEngine.startBGM(gameMode); } else { AudioEngine.stopBGM(); } }); document.getElementById('zen-btn').addEventListener('click', function() { startGame('zen'); }); document.getElementById('puzzle-btn').addEventListener('click', function() { openPuzzleSelect(); }); document.getElementById('puzzle-resume-btn').addEventListener('click', function() { startPuzzleAt(Math.min(puzzleProgress + 1, puzzleMaxStages)); }); document.getElementById('puzzle-select-close').addEventListener('click', function() { document.getElementById('puzzle-select-screen').classList.remove('active'); document.getElementById('menu-screen').classList.add('active'); }); document.getElementById('battle-btn').addEventListener('click', function() { startGame('battle'); }); document.getElementById('how-to-btn').addEventListener('click', function() { document.getElementById('how-to-modal').classList.add('active'); }); document.getElementById('close-how-to').addEventListener('click', function() { document.getElementById('how-to-modal').classList.remove('active'); }); document.getElementById('settings-btn').addEventListener('click', function() { document.getElementById('board-size').value = boardSize; document.getElementById('sound-toggle').checked = soundEnabled; document.getElementById('music-toggle').checked = musicEnabled; document.getElementById('difficulty').value = selectedDifficulty; document.getElementById('ai-difficulty').value = aiDifficulty; document.getElementById('battle-duration').value = battleDuration; document.getElementById('settings-modal').classList.add('active'); }); document.getElementById('close-settings').addEventListener('click', function() { soundEnabled = document.getElementById('sound-toggle').checked; var mc = document.getElementById('music-toggle').checked; if (mc !== musicEnabled) { musicEnabled = mc; if (gameState === 'playing') { if (musicEnabled) AudioEngine.startBGM(); else AudioEngine.stopBGM(); } else if (gameState === 'menu') { if (musicEnabled) AudioEngine.startMenuMusic(); else AudioEngine.stopMenuMusic(); } } selectedDifficulty = document.getElementById('difficulty').value; aiDifficulty = document.getElementById('ai-difficulty').value; battleDuration = parseInt(document.getElementById('battle-duration').value); var newBoardSize = document.getElementById('board-size').value; if (newBoardSize !== boardSize) { stopSpawning(); clearAllDice(); setBoardSize(newBoardSize); if (gameState === 'playing') startGame(gameMode); else quitToMenu(); } document.getElementById('settings-modal').classList.remove('active'); }); document.getElementById('pause-btn').addEventListener('click', pauseGame); document.getElementById('resume-btn').addEventListener('click', resumeGame); document.getElementById('restart-pause-btn').addEventListener('click', function() { startGame(gameMode); }); document.getElementById('quit-btn').addEventListener('click', quitToMenu); document.getElementById('retry-btn').addEventListener('click', function() { if (gameMode === 'puzzle') { if (puzzleCleared) { quitToMenu(); return; } window._puzzleChosenStage = puzzleStage; startGame('puzzle'); return; } startGame(gameMode); }); document.getElementById('menu-quit-btn').addEventListener('click', quitToMenu); }

var _frameCount = 0, _lastFpsTime = performance.now(), _currentFPS = 60, _lastFrameTime = performance.now();
function gameLoop() { requestAnimationFrame(gameLoop); _frameCount++; var now = performance.now(); if (now - _lastFpsTime >= 1000) { _currentFPS = Math.round(_frameCount * 1000 / (now - _lastFpsTime)); _frameCount = 0; _lastFpsTime = now; } var dt = Math.min((now - _lastFrameTime) / 1000, 0.05); _lastFrameTime = now; updateNebula(); updateStardust(); updateDynamicLight(); updateCircuitTrace(); updateTrailEmitter(); updateTrails(dt); updateAuraEmitter(); updateAura(); if (renderer && scene && camera) { if (composer) composer.render(); else renderer.render(scene, camera); } if (gameState === 'playing') { updateSinkingDice(); updateSinkingHighlights(); updateZenEffects(); updateAiMoveMarker(); var activeCount = countActiveDice(); updateFullnessBar(activeCount / totalCells); if (gameMode !== 'battle' && activeCount >= totalCells) triggerGameOver(); if (gameMode === 'battle') updateFreezeDisplay(); } }
function updateSinkingHighlights() { for (var x = 0; x < GRID_COLS; x++) for (var y = 0; y < GRID_ROWS; y++) { var hl = sinkingHighlights[x] && sinkingHighlights[x][y]; if (hl) { var die = grid[x] && grid[x][y]; hl.visible = !!(die && die.state === 'sinking'); } } }

window.onload = function() { document.getElementById('menu-highscore').innerText = Number(highScore).toLocaleString(); initEngine(); setupControlListeners(); gameLoop(); AudioEngine.startMenuMusic(); };

// ── Automation Hooks (for headless playtester) ──
Object.defineProperty(window, 'autoGameState', { get: function() {
    var matrix = [];
    for (var x = 0; x < GRID_COLS; x++) {
        matrix[x] = [];
        for (var y = 0; y < GRID_ROWS; y++) {
            var d = grid[x][y];
            matrix[x][y] = d ? {
                top: d.faces.top,
                state: d.state,
                type: d.cellType,
                height: d.height
            } : null;
        }
    }
    return {
        cols: GRID_COLS,
        rows: GRID_ROWS,
        matrix: matrix,
        score: score,
        comboCount: comboCount,
        gameMode: gameMode,
        gameState: gameState,
        activeSinkingGroups: activeSinkingGroups.length,
        aiMarkerVisible: !!(aiMoveMarker && aiMoveMarker.visible),
        animationLock: animationLock
    };
} });
Object.defineProperty(window, 'currentFPS', { get: function() { return _currentFPS; } });
Object.defineProperty(window, 'gridToScreen', { get: function() {
    return function(gx, gy) {
        if (!camera || !renderer) return { x: 0, y: 0 };
        var wx = (gx - (GRID_COLS - 1) / 2) * GRID_SPACING;
        var wz = (gy - (GRID_ROWS - 1) / 2) * GRID_SPACING;
        var v = new THREE.Vector3(wx, DIE_SCALE / 2, wz).project(camera);
        var rect = renderer.domElement.getBoundingClientRect();
        return {
            x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
            y: rect.top + (-(v.y * 0.5) + 0.5) * rect.height
        };
    };
} });
