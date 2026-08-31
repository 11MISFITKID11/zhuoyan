// 琢言 · Service Worker

const CACHE_NAME = 'zhuoyan-v3';
const CACHE_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/style.css',
  '/js/api-client.js',
  '/js/state.js',
  '/js/utils.js',
  '/js/ai-engine.js',
  '/js/docs.js',
  '/js/auth.js',
  '/js/polish.js',
  '/js/logic.js',
  '/js/aigc.js',
  '/js/agent.js',
  '/js/main.js',
  '/js/emoji-icons.js'
];

// 安装：缓存核心资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CACHE_FILES))
  );
});

// 激活：清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )
    )
  );
});

// 请求拦截
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin === self.origin) {
    event.respondWith(
      caches.match(event.request).then(response => {
        return response || fetch(event.request).catch(() => {
          // 尝试从缓存中加载主页面
          if (event.request.mode === 'navigate') {
            return caches.match('/');
          }
        });
      })
    );
  }
});

// 前端错误上报
self.addEventListener('error', (event) => {
  const report = {
    message: event.message,
    stack: event.error?.stack,
    url: event.filename,
    line: event.lineno,
    column: event.colno,
    timestamp: Date.now()
  };
  fetch('/api/log/error', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report)
  });
});
