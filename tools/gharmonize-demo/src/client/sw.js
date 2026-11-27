// Gharmonize Player demo Service Worker (v__VERSION__).
// The Player asks for audio and covers at /api/player/... and loads a few
// files from the site root (/src, /lang, /i18n.js). Media requests are
// answered with a redirect to the real Deezer preview / cover, which the
// page (where the demo server runs) looks up; root files come from the demo folder.
const BASE = new URL('./', self.location).pathname
const MEDIA = /^\/api\/player\/(stream|artwork|online\/preview)\//

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return
  const p = url.pathname
  if (MEDIA.test(p)) {
    event.respondWith(media(event, url))
    return
  }
  if (p.startsWith('/api/')) {
    event.respondWith(new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not available in the demo.' } }), { status: 404, headers: { 'Content-Type': 'application/json' } }))
    return
  }
  if (!p.startsWith(BASE) && (p.startsWith('/src/') || p.startsWith('/lang/') || p === '/i18n.js' || p.startsWith('/player/'))) {
    event.respondWith(fetch(BASE + p.slice(1) + url.search))
  }
})

async function media(event, url) {
  let client = event.clientId ? await self.clients.get(event.clientId) : null
  if (!client) client = (await self.clients.matchAll({ type: 'window' })).find((c) => new URL(c.url).pathname.startsWith(BASE))
  if (!client) return new Response('', { status: 503 })
  const target = await ask(client, url.pathname.slice('/api/player'.length), url.search)
  if (!target) return new Response('', { status: 404 })
  // Covers are passed through as same-origin images: the Player reads their
  // colours (canvas), which a redirected cross-origin image would not allow.
  // Deezer's image CDN sends CORS headers. Audio keeps the redirect (ranges).
  if (url.pathname.startsWith('/api/player/artwork/')) {
    try {
      const res = await fetch(target, { mode: 'cors', credentials: 'omit' })
      if (res.ok) return new Response(res.body, { status: 200, headers: { 'Content-Type': res.headers.get('Content-Type') || 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } })
    } catch {}
  }
  return Response.redirect(target, 302)
}

function ask(client, path, search) {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => resolve(null), 20_000)
    channel.port1.onmessage = (e) => { clearTimeout(timer); resolve(e.data?.url || null) }
    client.postMessage({ type: 'gharmonize-demo:media', path, search }, [channel.port2])
  })
}
