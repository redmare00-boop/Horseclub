const CACHE_NAME = 'horseclub-v1'
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/chat.html',
  '/login.html',
  '/register.html',
  '/style.css',
  '/app.js',
  '/chat.js',
  '/login.js',
  '/register.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(URLS_TO_CACHE))
  )
})

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request)
    })
  )
})