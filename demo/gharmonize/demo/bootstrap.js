// Starts the Gharmonize Player demo: Service Worker, the in-browser demo
// server, then the unchanged Player web client. The Player's own requests
// (fetch, EventSource, sendBeacon to /api/player/...) are answered here.

const demoRoot = new URL('../', import.meta.url)
// Same choice as the Player's i18n.js: saved language, else the browser's.
const lang = () => {
  let saved = ''
  try { saved = localStorage.getItem('lang') || '' } catch {}
  return (saved || navigator.language || 'en').slice(0, 2).toLowerCase()
}

const TEXT = {
  en: {
    badge: 'Demo',
    title: 'Gharmonize Player demo',
    body: 'Songs play as 30-second Deezer previews. Downloads, download groups and discography completion are simulated: no file is downloaded. YouTube and Spotify results are simulated from Deezer data. Your favorites, playlists and history are saved in this browser only.',
    reset: 'Reset demo',
    resetAsk: 'Reset the demo? Favorites, playlists, history and simulated downloads in this browser will be removed.',
    portal: 'Back to portal',
    close: 'Close',
    downloadsNote: 'Demo: downloads here are simulated. No file is downloaded from YouTube, Spotify or Deezer; finished songs are added to the demo library and play as 30-second previews.',
    download: 'Demo: this download is simulated. No file is downloaded; the songs are added to the demo library as previews.',
    loading: 'Preparing the demo library…',
    unsupported: 'This demo needs a modern browser with Service Worker support (and not a private window in some browsers).',
    failed: 'The demo could not start.'
  },
  tr: {
    badge: 'Demo',
    title: 'Gharmonize Player demosu',
    body: 'Şarkılar Deezer’ın 30 saniyelik önizlemeleriyle çalınır. İndirmeler, indirme grupları ve diskografi tamamlama simülasyondur: hiçbir dosya indirilmez. YouTube ve Spotify sonuçları Deezer verisinden simüle edilir. Favorileriniz, çalma listeleriniz ve geçmişiniz yalnızca bu tarayıcıda saklanır.',
    reset: 'Demoyu sıfırla',
    resetAsk: 'Demo sıfırlansın mı? Bu tarayıcıdaki favoriler, çalma listeleri, geçmiş ve simüle edilen indirmeler silinecek.',
    portal: 'Portala dön',
    close: 'Kapat',
    downloadsNote: 'Demo: Buradaki indirmeler simülasyondur. YouTube, Spotify veya Deezer’dan hiçbir dosya indirilmez; tamamlanan şarkılar demo kütüphanesine eklenir ve 30 saniyelik önizleme olarak çalınır.',
    download: 'Demo: Bu indirme simülasyondur. Hiçbir dosya indirilmez; şarkılar demo kütüphanesine önizleme olarak eklenir.',
    loading: 'Demo kütüphanesi hazırlanıyor…',
    unsupported: 'Bu demo, Service Worker destekleyen güncel bir tarayıcı gerektirir (bazı tarayıcılarda gizli pencerede çalışmaz).',
    failed: 'Demo başlatılamadı.'
  }
}
const tx = (key) => (TEXT[lang()] || TEXT.en)[key]

function bootMessage(text, error = false) {
  const boot = document.getElementById('boot')
  if (!boot) return
  let note = boot.querySelector('.demo-boot-note')
  if (!note) { note = document.createElement('p'); note.className = 'demo-boot-note'; boot.append(note) }
  note.textContent = text
  note.classList.toggle('is-error', error)
  if (error) boot.querySelector('.spinner')?.remove()
}

async function serviceWorkerReady() {
  if (!('serviceWorker' in navigator)) throw new Error('unsupported')
  await navigator.serviceWorker.register(new URL('sw.js', demoRoot), { scope: demoRoot.pathname })
  if (navigator.serviceWorker.controller) return
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('unsupported')), 10_000)
    navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(timer); resolve() }, { once: true })
  })
}

// ---- demo notice ------------------------------------------------------------------
// A "Demo" chip in the Player's top bar (where the real app links back to
// Gharmonize) with what the demo does, and the Player's own toasts.

let playerToast = null
function toast(text) {
  if (playerToast) playerToast(text, { timeout: 6500 })
}

function badge(server, dom) {
  const panel = document.createElement('div')
  panel.className = 'demo-panel'
  panel.hidden = true
  panel.setAttribute('role', 'dialog')
  let chip = null
  const paintPanel = () => {
    panel.replaceChildren()
    const h = document.createElement('b'); h.textContent = tx('title')
    const p = document.createElement('p'); p.textContent = tx('body')
    const row = document.createElement('div'); row.className = 'demo-panel__actions'
    const portal = document.createElement('a'); portal.className = 'btn btn--outline btn--sm'; portal.href = new URL('../../', demoRoot).href; portal.textContent = tx('portal')
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'btn btn--ghost btn--sm demo-panel__reset'; reset.textContent = tx('reset')
    reset.addEventListener('click', () => { if (confirm(tx('resetAsk'))) { server.reset(); location.reload() } })
    row.append(portal, reset)
    panel.append(h, p, row)
    panel.setAttribute('aria-label', tx('title'))
  }
  const place = () => {
    if (!chip?.isConnected) return
    const r = chip.getBoundingClientRect()
    const width = panel.offsetWidth || 380
    panel.style.top = `${Math.round(r.bottom + 8)}px`
    panel.style.left = `${Math.round(Math.max(12, Math.min(r.right - width, window.innerWidth - width - 12)))}px`
  }
  const toggle = (open) => {
    if (open && !chip?.isConnected) return
    panel.hidden = !open
    chip?.setAttribute('aria-expanded', String(open))
    if (open) requestAnimationFrame(place)
  }
  const makeChip = () => {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'topbar__home demo-chip'
    el.setAttribute('aria-expanded', 'false')
    el.setAttribute('aria-haspopup', 'dialog')
    el.title = tx('title')
    el.setAttribute('aria-label', tx('title'))
    el.append(dom.icon('info', { size: 18 }), Object.assign(document.createElement('span'), { textContent: tx('badge') }))
    el.addEventListener('click', (e) => { e.stopPropagation(); toggle(panel.hidden) })
    return el
  }
  // The Player rebuilds its top bar (language change, sign-in): keep the chip in it.
  const mount = () => {
    const right = document.querySelector('#app:not([hidden]) .topbar__right')
    if (!right || right.querySelector('.demo-chip')) return
    chip = makeChip()
    right.prepend(chip)
    paintPanel()
  }
  new MutationObserver(mount).observe(document.getElementById('app'), { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] })
  document.addEventListener('click', (e) => { if (!panel.hidden && !panel.contains(e.target) && !chip?.contains(e.target)) toggle(false) })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggle(false) })
  window.addEventListener('resize', place)
  document.addEventListener('i18n:applied', () => { paintPanel(); if (chip) { chip.remove(); chip = null; mount() } })
  document.body.append(panel)
  mount()
  // A permanent note on the downloads page.
  const noteOnDownloads = () => {
    const host = document.getElementById('view')
    if (!host || !/^#\/downloads/.test(location.hash) || host.querySelector('.demo-note')) return
    const note = document.createElement('p')
    note.className = 'note demo-note'
    note.append(dom.icon('info', { size: 16 }), document.createTextNode(` ${tx('downloadsNote')}`))
    host.prepend(note)
  }
  new MutationObserver(noteOnDownloads).observe(document.getElementById('app'), { childList: true, subtree: true })
  window.addEventListener('hashchange', () => setTimeout(noteOnDownloads, 50))
  noteOnDownloads()
  // First visit: open it once so the visitor reads what the demo does.
  try {
    if (!localStorage.getItem('ghd.seen')) {
      localStorage.setItem('ghd.seen', '1')
      const wait = setInterval(() => { if (chip?.isConnected) { clearInterval(wait); setTimeout(() => toggle(true), 600) } }, 200)
      setTimeout(() => clearInterval(wait), 15_000)
    }
  } catch {}
}

// ---- answering the Player's requests -------------------------------------------------

function install(server) {
  const realFetch = window.fetch.bind(window)
  const MEDIA = /^\/(stream|artwork|online\/preview)\//
  let toldDownload = 0

  window.fetch = async (input, init = {}) => {
    const req = input instanceof Request ? input : null
    const url = new URL(req ? req.url : String(input), location.href)
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return realFetch(input, init)
    if (!url.pathname.startsWith('/api/player/')) return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })
    const path = url.pathname.slice('/api/player'.length)
    if (MEDIA.test(path)) {
      const target = await server.resolveMedia(path, url.search).catch(() => null)
      return target ? realFetch(target, { signal: init.signal }) : new Response('', { status: 404 })
    }
    const method = String(init.method || req?.method || 'GET').toUpperCase()
    let body
    const raw = init.body ?? (req && method !== 'GET' ? await req.text() : undefined)
    if (typeof raw === 'string' && raw) { try { body = JSON.parse(raw) } catch {} }
    if (method === 'POST' && /^\/downloads(\/groups)?$/.test(path) && Date.now() - toldDownload > 8000) {
      toldDownload = Date.now()
      toast(tx('download'))
    }
    const res = await server.handle(method, path, Object.fromEntries(url.searchParams), body)
    return new Response(JSON.stringify(res.body), { status: res.status, headers: { 'Content-Type': 'application/json' } })
  }

  const RealEventSource = window.EventSource
  class DemoEventSource extends EventTarget {
    constructor(url) {
      super()
      this.url = String(url)
      this.readyState = 0
      this.withCredentials = false
      this.offs = []
      const fire = (type, data) => {
        if (this.readyState === 2) return
        const event = new MessageEvent(type, { data: JSON.stringify(data) })
        this.dispatchEvent(event)
        if (type === 'message') this.onmessage?.(event)
      }
      const listen = (emitter, name, type) => {
        const fn = (data) => fire(type, data || {})
        emitter.on(name, fn)
        this.offs.push(() => emitter.off(name, fn))
      }
      listen(server.events, 'update', 'download')
      listen(server.events, 'group', 'group')
      listen(server.scannerEvents, 'removed', 'library-removed')
      setTimeout(() => {
        if (this.readyState === 2) return
        this.readyState = 1
        const open = new Event('open')
        this.dispatchEvent(open)
        this.onopen?.(open)
        fire('ready', {})
      }, 0)
    }
    close() { this.readyState = 2; for (const off of this.offs.splice(0)) off() }
  }
  DemoEventSource.CONNECTING = 0
  DemoEventSource.OPEN = 1
  DemoEventSource.CLOSED = 2
  window.EventSource = function EventSource(url, options) {
    const u = new URL(String(url), location.href)
    if (u.origin === location.origin && u.pathname === '/api/player/downloads/events') return new DemoEventSource(u.href)
    return new RealEventSource(url, options)
  }

  const realBeacon = navigator.sendBeacon?.bind(navigator)
  navigator.sendBeacon = (url, data) => {
    const u = new URL(String(url), location.href)
    if (u.origin === location.origin && u.pathname.startsWith('/api/player/')) {
      Promise.resolve(data instanceof Blob ? data.text() : String(data || ''))
        .then((text) => server.handle('POST', u.pathname.slice('/api/player'.length), {}, text ? JSON.parse(text) : {}))
        .catch(() => {})
      return true
    }
    return realBeacon ? realBeacon(url, data) : false
  }

  navigator.serviceWorker.addEventListener('message', async (event) => {
    if (event.data?.type !== 'gharmonize-demo:media') return
    const url = await server.resolveMedia(event.data.path, event.data.search).catch(() => null)
    event.ports[0]?.postMessage({ url })
  })
}

async function start() {
  try {
    await serviceWorkerReady()
  } catch {
    bootMessage(tx('unsupported'), true)
    return
  }
  let server
  const slow = setTimeout(() => bootMessage(tx('loading')), 700)
  try {
    const { startDemoServer } = await import('./server.js')
    server = await startDemoServer({ wasmUrl: new URL('sqlite3.wasm', import.meta.url).href, onProgress: () => bootMessage(tx('loading')) })
  } catch (error) {
    clearTimeout(slow)
    console.error('[demo]', error)
    bootMessage(`${tx('failed')} ${error?.message || ''}`, true)
    return
  }
  clearTimeout(slow)
  document.querySelector('.demo-boot-note')?.remove()
  install(server)
  await import('../player/js/main.js')
  const dom = await import('../player/js/dom.js')
  playerToast = dom.toast
  badge(server, dom)
}

start()
