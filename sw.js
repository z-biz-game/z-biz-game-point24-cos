// 离线壳。缓存名带版本号（POINT24_CACHE 一改就是全新一次冷启动，不会拿旧包配新 HTML）。
// 对**同源子资源**一律"网络优先、失败退缓存"：手工 VERSION + cache-first 会把 js/css 永久
// 钉死在旧版，出新 HTML 配旧 JS 的鬼状态（规范 §2 点名的坑）。只有带版本号的壳资源本身
// 才走 cache-first。file:// 下 SW 根本不会注册，这里也不假设任何 window 全局。

const VERSION = 'v2.0.0';
const CACHE = `point24-${VERSION}`;
const SHELL = ['./', './index.html', './css/game.css', './js/main.js'];
const ASSETS = [
  './icons/favicon-32.png', './icons/favicon-16.png', './icons/apple-touch-icon.png',
  './icons/icon-192.png', './icons/icon-512.png', './manifest.webmanifest',
  './img/felt.png', './img/pips.png',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled([...SHELL, ...ASSETS].map((u) => cache.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function sameOrigin(url) {
  try { return new URL(url, self.location.href).origin === self.location.origin; } catch (err) { return false; }
}

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET' || !sameOrigin(req.url)) return;
  const url = new URL(req.url, self.location.href);
  if (url.pathname.endsWith('/sw.js')) return; // 永远拿最新的自己
  const isShell = SHELL.concat(ASSETS).some((s) => url.pathname.endsWith(s.replace(/^\./, '')));

  ev.respondWith((async () => {
    if (isShell) {
      const hit = await caches.match(req);
      if (hit) return hit;
    }
    // 网络优先：拿得回来就顺手刷新缓存，拿不回来（离线/断网）才退到缓存。
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok && (req.destination === 'script' || req.destination === 'style'
        || req.destination === 'image' || req.destination === 'manifest' || req.mode === 'navigate')) {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      const stale = await caches.match(req);
      if (stale) return stale;
      if (req.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});

self.addEventListener('message', (ev) => {
  if (ev.data && ev.data.type === 'skipWaiting') self.skipWaiting();
});
