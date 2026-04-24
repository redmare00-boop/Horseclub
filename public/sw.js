const CACHE_NAME = 'horseclub-v25'
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/venue.html',
  '/chat.html',
  '/login.html',
  '/register.html',
  '/change-password.html',
  '/invite.html',
  '/admin-users.html',
  '/admin-venues.html',
  '/style.css',
  '/home.js',
  '/venue.js',
  '/admin-users.js',
  '/admin-venues.js',
  '/chat.js',
  '/login.js',
  '/register.js',
  '/change-password.js',
  '/invite.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(URLS_TO_CACHE)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    }).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request

  // Always try to refresh HTML pages so UI updates aren't stuck.
  const accept = req.headers.get('accept') || ''
  const isHtml = req.mode === 'navigate' || accept.includes('text/html')

  if (isHtml) {
    event.respondWith(
      fetch(req)
        .then((netRes) => {
          const copy = netRes.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy))
          return netRes
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/index.html')))
    )
    return
  }

  // Static assets: stale-while-revalidate for CSS/JS so fixes arrive quickly.
  const url = new URL(req.url)
  const isSameOrigin = url.origin === self.location.origin
  const isCssOrJs =
    isSameOrigin &&
    (url.pathname.endsWith('.css') || url.pathname.endsWith('.js') || req.destination === 'style' || req.destination === 'script')

  if (isCssOrJs) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const fetchAndUpdate = fetch(req)
          .then((netRes) => {
            const copy = netRes.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy))
            return netRes
          })
          .catch(() => cached)
        return cached || fetchAndUpdate
      })
    )
    return
  }

  // Cache-first for other static assets.
  event.respondWith(caches.match(req).then((cached) => cached || fetch(req)))
})