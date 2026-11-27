// Service worker لـ Phase 10
// الملفات بتاعتنا: نجيب الأحدث من النت الأول (عشان التحديثات توصل فوراً)، ولو مفيش نت نرجع للنسخة المحفوظة.
// الأصوات والأيقونات والخطوط: من المحفوظ الأول (أسرع).
// Firebase والطلبات اللي مش GET: ما نلمسهاش خالص.
const CACHE = 'p10-v1';
const CORE = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './sounds/lion.mp3?v=1', './sounds/sheep.mp3?v=1'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).catch(() => {}));
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    const sameOrigin = url.origin === self.location.origin;
    const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
    const isFirebaseLib = url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/');
    if (!sameOrigin && !isFont && !isFirebaseLib) return; // Firestore/Auth وغيرهم: النت مباشرة

    const cacheFirst = isFont || isFirebaseLib || /\/(sounds|icons)\//.test(url.pathname);
    if (cacheFirst) {
        e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
            if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
            return res;
        })));
        return;
    }
    // network-first
    e.respondWith(fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html'))));
});
