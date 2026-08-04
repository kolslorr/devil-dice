const CACHE_NAME = 'devildice-v4';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './game.js',
    './manifest.json',
    'audio/menu.mp3',
    'audio/zen.mp3',
    'audio/battle.mp3',
    'audio/puzzle.mp3',
    'audio/win.mp3',
    'audio/lose.mp3',
    'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'
];

// Install Event
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        }).then(() => {
            return self.skipWaiting();
        })
    );
});

// Activate Event
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => {
            return self.clients.claim();
        })
    );
});

// Fetch Event — NETWORK-FIRST for same-origin (the game is served from
// localhost; every change must reach the browser immediately, with the cache
// as an offline fallback). CACHE-FIRST only for the cross-origin three.js CDN.
// NOTE: the previous cache-first strategy silently served stale game.js/
// index.html forever (the old build had music disabled by default — the user
// heard nothing after the audio overhaul). Bumping CACHE_NAME + network-first
// fixes that.
self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin === location.origin) {
        // Same-origin: try network, fall back to cache (and offline document)
        e.respondWith(
            fetch(req).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const clone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(req, clone);
                    });
                }
                return networkResponse;
            }).catch(() => {
                return caches.match(req).then((cached) => {
                    if (cached) return cached;
                    if (req.mode === 'navigate') return caches.match('./index.html');
                    return new Response('', { status: 504 });
                });
            })
        );
    } else {
        // Cross-origin (three.js CDN): cache-first
        e.respondWith(
            caches.match(req).then((cached) => {
                if (cached) return cached;
                return fetch(req).then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        const clone = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(req, clone);
                        });
                    }
                    return networkResponse;
                });
            })
        );
    }
});
