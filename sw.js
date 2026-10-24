// 智动计划 Service Worker - 离线缓存（网络优先，改动即时生效）
const CACHE_NAME = 'zhidong-plan-v106';
const ASSETS = ['./', './index.html', './style.css', './app.js', './manifest.json', './app-icon-512.png', './coach-avatar.svg', './coach-lin.svg',
  './mediapipe/vision.mjs',
  './mediapipe/pose_landmarker_lite.task',
  './mediapipe/wasm/vision_wasm_internal.js',
  './mediapipe/wasm/vision_wasm_internal.wasm',
  './mediapipe/wasm/vision_wasm_nosimd_internal.js',
  './mediapipe/wasm/vision_wasm_nosimd_internal.wasm'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // API 请求、/@vite/（预览环境HMR）和非 GET 请求一律直接走网络，不缓存也不回退缓存
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api') || url.pathname.startsWith('/@vite')) {
    return;
  }
  // 网络优先：在线时永远拿最新文件，离线时回退到缓存
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        // 视频等大文件只透传、不写缓存，避免撑爆离线缓存容量
        if (!/\.(mp4|webm)$/.test(url.pathname)) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, copy));
        }
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});
