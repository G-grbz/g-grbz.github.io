// Gharmonize Player demo server: the Player's own server modules (catalog,
// mixes, statistics, discovery, download bridge, scanner …) running in the
// browser on SQLite (WebAssembly). Routes mirror modules/player/router.js;
// server administration, device pairing and CD ripping are left out.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import { initSqlite, hasSavedDatabase, persist, clearSaved } from '../shims/node-sqlite.js'
import { openPlayerDatabase, getSetting, setSetting } from '@player/db.js'
import { createScanner, normalizeKey } from '@player/scanner.js'
import { createCatalog } from '@player/catalog.js'
import { createAccess } from '@player/access.js'
import { createMixes } from '@player/mixes.js'
import { createStats } from '@player/stats.js'
import { createLyricsService } from '@player/lyrics.js'
import { createLibraryMatcher } from '@player/matching.js'
import { createOnlineSearch, freshDeezerPreview } from '@player/online.js'
import { createDownloadBridge } from '@player/bridge.js'
import { createOnlineCache } from '@player/onlineCache.js'
import { createAnnotator } from '@player/annotate.js'
import { createDiscovery } from '@player/discovery.js'
import { createDeezerSource } from '@player/discoverySources.js'
import { createFollows } from '@player/follows.js'
import { createReleaseWatch } from '@player/releases.js'
import { createSearchHistory } from '@player/searchHistory.js'
import { createArtistCredits } from '@player/artistCredits.js'
import { createBiography } from '@player/biography.js'
import { publicUser } from '../stubs/auth.js'
import { DEFAULT_CONFIG } from './config.js'
import { deezerFetch, coverUrl, artistPictureUrl } from './deezer.js'
import {
  LIBRARY_ROOT, writeSong, parseVirtualFile, createFakeCore, makeSpotifyClient, youtubeSearch, youtubePlaylistSearch,
  deezerTrackOfPath, deezerAlbumOfPath, deezerIdOf, decodeSource
} from './sim.js'
import library from '../../data/library.json'

const USER_ID = 1
const SESSION_KEY = 'ghd.session'
const VERSION = __GHARMONIZE_VERSION__

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}

const logger = { log() {}, info() {}, debug() {}, warn: (...a) => console.warn('[demo]', ...a), error: (...a) => console.error('[demo]', ...a) }

// ---- online helpers ------------------------------------------------------------

const wikiFetch = (url, init = {}) => {
  let u = String(url)
  if (/\/w\/api\.php\?/.test(u) && !/[?&]origin=/.test(u)) u += '&origin=*'
  return fetch(u, { signal: init.signal, headers: { Accept: 'application/json' } })
}

async function lrclib(artist, title, duration) {
  const q = new URLSearchParams({ artist_name: artist || '', track_name: title || '' })
  if (duration) q.set('duration', String(Math.round(duration)))
  let res = await fetch(`https://lrclib.net/api/get?${q}`)
  let data = res.ok ? await res.json() : null
  if (!data) {
    res = await fetch(`https://lrclib.net/api/search?${new URLSearchParams({ q: `${artist} ${title}` })}`)
    const list = res.ok ? await res.json() : []
    data = Array.isArray(list) ? list.find((x) => x.plainLyrics) : null
  }
  // Only plain text: the demo plays a 30 s excerpt, timed lines would not match.
  return data?.plainLyrics ? { plainLyrics: data.plainLyrics } : null
}

// A waveform shape for the "wave" seek bar (the demo has no audio files).
function fakeWaveform(seed) {
  let x = (Number(seed) || 1) % 2147483647
  const rnd = () => (x = (x * 48271) % 2147483647) / 2147483647
  const bins = []
  let v = 40
  for (let i = 0; i < 240; i++) {
    v += (rnd() - 0.5) * 22
    v = Math.max(18, Math.min(96, v))
    const env = i < 6 ? (i + 1) / 7 : i > 232 ? (240 - i) / 8 : 1
    bins.push(Math.round(v * env))
  }
  return bins
}

// ---- server ------------------------------------------------------------------

export async function startDemoServer({ wasmUrl, onProgress = () => {} } = {}) {
  await initSqlite(sqlite3InitModule, { locateFile: () => wasmUrl })
  const fresh = !hasSavedDatabase()
  const db = await openPlayerDatabase('/demo/data')
  db.exec('CREATE TABLE IF NOT EXISTS demo_art (key TEXT PRIMARY KEY, url TEXT NOT NULL)')

  let config = { ...DEFAULT_CONFIG, ...(getSetting(db, 'demo_config', {}) || {}) }
  const getConfig = () => config

  const setArt = (key, url) => { if (key && url) db.prepare('INSERT INTO demo_art (key, url) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET url = excluded.url').run(key, url) }
  const getArt = (key) => db.prepare('SELECT url FROM demo_art WHERE key = ?').get(key)?.url || null

  // Seed time travel: albums "added" over the last weeks, plays over months.
  let clock = null
  const now = () => clock ?? Date.now()

  try { createArtistCredits(db).migrate() } catch {}
  const access = createAccess(db)
  const catalog = createCatalog(db, { now })
  const mixes = createMixes(db)
  const scanner = createScanner(db, { parseFile: parseVirtualFile, logger, now, onTrackChanges: () => mixes.invalidate() })
  const stats = createStats(db, { catalog })
  const libraries = {
    resolveTrackFile: (track) => `${LIBRARY_ROOT}/${track.rel_path}`,
    downloadTarget: () => null,
    upgradeTarget: () => { throw new HttpError(409, 'UPGRADE_UNAVAILABLE', 'Not available in the demo.') },
    list: () => db.prepare('SELECT * FROM libraries').all()
  }
  const lyrics = createLyricsService({ libraries, getOnlineAllowed: () => true, fetchOnline: lrclib, logger })
  const matcher = createLibraryMatcher(db)
  const online = createOnlineSearch({
    getEnabledProviders: () => config.onlineProviders,
    logger,
    fetchImpl: deezerFetch,
    searchImpl: youtubeSearch,
    searchPlaylistsImpl: youtubePlaylistSearch,
    makeClient: async () => makeSpotifyClient()
  })
  const core = createFakeCore({ onArt: setArt })
  const bridge = createDownloadBridge({ db, core, scanner, matcher, catalog, getConfig, getDownloadTarget: () => null, getUpgradeTarget: libraries.upgradeTarget, logger, pollMs: 600 })
  const onlineCache = createOnlineCache(db, { logger })
  const annotator = createAnnotator({ matcher, bridge, catalog, mappedLinks: async () => [] })
  const searchHistory = createSearchHistory(db, { catalog, annotator })
  const unavailable = (name) => ({ name, available: () => false })
  const sources = { deezer: createDeezerSource({ fetchImpl: deezerFetch }), youtube: unavailable('youtube'), spotify: unavailable('spotify'), apple: unavailable('apple') }
  const artistPhotos = {
    remember(artistId, name, url) {
      const row = db.prepare('SELECT name FROM artists WHERE id = ?').get(Number(artistId))
      if (row && url) setArt(`artist:${normalizeKey(row.name)}`, url)
    }
  }
  const discovery = createDiscovery({ db, cache: onlineCache, annotator, getConfig, logger, sources, artistPhotos })
  const biography = createBiography({ cache: onlineCache, fetchImpl: wikiFetch, env: { SPOTIFY_MARKET: navigator.language?.slice(0, 2).toUpperCase() === 'TR' ? 'TR' : 'US' }, logger })
  const getUser = () => publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(USER_ID))
  const follows = createFollows({ db, discovery, bridge, catalog, getUser, logger })
  const releases = createReleaseWatch({ db, discovery, bridge, annotator, getUser, logger })

  if (fresh) await seed()
  mixes.invalidate()
  bridge.start()

  // ---- first run: demo user, library and listening history ---------------------

  async function seed() {
    onProgress('library')
    const t0 = Date.now()
    db.prepare(`INSERT OR IGNORE INTO users (id, username, display_name, password_hash, role, can_download, all_libraries, created_at, updated_at)
      VALUES (?, 'demo', 'Demo', '-', 'user', 1, 1, ?, ?)`).run(USER_ID, t0 - 120 * 86_400_000, t0)
    db.prepare(`INSERT OR IGNORE INTO libraries (id, name, path, enabled, is_default, created_at) VALUES (1, 'Demo', ?, 1, 1, ?)`).run(LIBRARY_ROOT, t0)
    for (const a of library.artists) if (a.picture) setArt(`artist:${normalizeKey(a.name)}`, artistPictureUrl(a.picture))
    // Albums arrive one after another over the last ten weeks.
    const albums = [...library.albums]
    for (const [i, album] of albums.entries()) {
      setArt(`album:${album.dz}`, coverUrl(album.cover))
      const files = album.tracks.map((t) => writeSong({ ...t, album: album.title, albumArtist: album.artist, albumDz: album.dz, year: album.year, genre: album.genre }))
      clock = t0 - (albums.length - i) * 5 * 86_400_000
      await scanner.indexFiles(files)
    }
    clock = null
    // Listening history: favourites get played most.
    const tracks = db.prepare('SELECT id, album_id, duration FROM tracks ORDER BY id').all()
    let x = 20250101
    const rnd = () => (x = (x * 48271) % 2147483647) / 2147483647
    const albumIds = [...new Set(tracks.map((t) => t.album_id))]
    const loved = new Set(albumIds.filter(() => rnd() < 0.45))
    const weighted = tracks.flatMap((t) => Array(loved.has(t.album_id) ? 6 : 1).fill(t))
    const plays = []
    for (let i = 0; i < 520; i++) {
      const t = weighted[Math.floor(rnd() * weighted.length)]
      const daysAgo = Math.pow(rnd(), 1.6) * 150
      plays.push({ t, at: t0 - daysAgo * 86_400_000 - rnd() * 3_600_000 * 6 })
    }
    plays.sort((a, b) => a.at - b.at)
    for (const p of plays) {
      clock = p.at
      const full = rnd() < 0.85
      catalog.recordPlay(USER_ID, { trackId: p.t.id, playedMs: full ? p.t.duration * 1000 : 12_000, completed: full, context: '' })
    }
    clock = null
    // A few favourites and two playlists.
    const pick = (n) => tracks.filter(() => rnd() < n)
    for (const t of pick(0.14)) catalog.setFavorite(USER_ID, 'track', t.id, true)
    for (const id of albumIds.filter(() => rnd() < 0.3)) catalog.setFavorite(USER_ID, 'album', id, true)
    const tr = /^tr\b/i.test(navigator.language || '')
    const road = catalog.createPlaylist(USER_ID, { name: tr ? 'Yol Şarkıları' : 'Road Trip', description: tr ? 'Uzun yollar için' : 'For long drives' })
    catalog.addPlaylistTracks(road.id, USER_ID, pick(0.12).map((t) => t.id))
    const calm = catalog.createPlaylist(USER_ID, { name: tr ? 'Sakin Akşam' : 'Quiet Evening', description: '' })
    catalog.addPlaylistTracks(calm.id, USER_ID, pick(0.08).map((t) => t.id))
    // Follow a few artists for "new releases" notifications.
    for (const name of ['Tarkan', 'Dua Lipa', 'Duman']) { try { catalog.followArtistByName(USER_ID, name, true) } catch {} }
    await persist()
  }

  // ---- helpers -----------------------------------------------------------------

  const signedIn = () => { try { return localStorage.getItem(SESSION_KEY) !== '0' } catch { return true } }
  const intParam = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null }
  const bool = (v) => ['1', 'true', 'yes', 'on'].includes(String(v ?? '').trim().toLowerCase())

  // Simulated Spotify / YouTube results: their 30 s preview comes from the
  // Deezer recording they were matched with.
  function withPreviews(value) {
    if (Array.isArray(value)) return value.map(withPreviews)
    if (!value || typeof value !== 'object') return value
    if (value.kind === 'track' && value.provider && value.provider !== 'deezer' && value.provider !== 'library' && !value.previewUrl) {
      const alt = (value.alternatives || []).map((a) => decodeSource(a.url)).find((s) => s?.provider === 'deezer' && s.kind === 'track')
      const own = decodeSource(value.url)
      const id = alt?.id || (own?.kind === 'track' ? own.id : null)
      if (id) value.previewUrl = `/api/player/online/preview/deezer/${id}`
    }
    for (const k of Object.keys(value)) if (value[k] && typeof value[k] === 'object') value[k] = withPreviews(value[k])
    return value
  }

  // Online pages of simulated providers open the matching Deezer page.
  function onlineQuery(query) {
    const provider = String(query.provider || '')
    if (provider === 'spotify' || provider === 'youtube') {
      const id = deezerIdOf(provider, query.id) || decodeSource(query.url)?.id
      if (id) return { ...query, provider: 'deezer', id, url: undefined }
    }
    return query
  }

  const suggestionsFor = async ({ seedIds = [], artists = [], seedKey = '', limit = 24 }) => {
    const user = getUser()
    let radio = { enabled: false, items: [], ownedIds: [] }
    try { radio = await discovery.radioSuggestions(user, { artists, seedKey, limit: Math.ceil(limit / 2) }) } catch {}
    const seeds = new Set(seedIds.map(Number))
    const fromRadio = catalog.getTracksByIds([...new Set(radio.ownedIds || [])].filter((id) => !seeds.has(Number(id))).slice(0, 8), USER_ID)
    const similar = catalog.similarTracks(USER_ID, { seedIds: seedIds.slice(0, 200), excludeIds: fromRadio.map((tr) => tr.id), limit: Math.ceil(limit / 2) })
    const lib = [...fromRadio, ...similar].slice(0, Math.ceil(limit / 2)).map((tr) => ({
      provider: 'library', kind: 'track', id: String(tr.id), url: `library:track:${tr.id}`, title: tr.title, artist: tr.artist || '', album: tr.album || '',
      duration: tr.duration || 0, artwork: tr.artwork, artworkUrl: null, library: { trackId: tr.id, ...(tr.albumId ? { albumId: tr.albumId } : {}) }, download: null
    }))
    const onl = radio.items || []
    const items = []
    for (let i = 0; i < Math.max(lib.length, onl.length); i++) { if (lib[i]) items.push(lib[i]); if (onl[i]) items.push(onl[i]) }
    return { enabled: Boolean(radio.enabled) || lib.length > 0, items: items.slice(0, limit), libraryCount: lib.length, onlineCount: onl.length }
  }

  const annotateOnline = (result) => ({ ...result, tracks: annotator.items(result.tracks, USER_ID), albums: annotator.items(result.albums, USER_ID), artists: annotator.items(result.artists, USER_ID), playlists: annotator.items(result.playlists || [], USER_ID) })

  // ---- routes (method, pattern, handler) --------------------------------------------

  const routes = []
  const on = (method, pattern, handler, { auth = true } = {}) => {
    const keys = []
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)' })}$`)
    routes.push({ method, re, keys, handler, auth })
  }

  on('GET', '/status', () => ({
    enabled: true, name: 'Gharmonize Player', version: VERSION, setupRequired: false, network: 'lan', remoteAccess: 'off',
    user: signedIn() ? getUser() : null, gharmonizeAdmin: false, demo: true
  }), { auth: false })
  on('POST', '/auth/login', ({ body }) => {
    if (!String(body?.username || '').trim() || !String(body?.password || '')) throw new HttpError(401, 'BAD_CREDENTIALS', 'Wrong username or password.')
    try { localStorage.setItem(SESSION_KEY, '1') } catch {}
    return { user: getUser(), expiresAt: Date.now() + 30 * 86_400_000 }
  }, { auth: false })
  on('POST', '/auth/logout', () => { try { localStorage.setItem(SESSION_KEY, '0') } catch {} ; return { ok: true } }, { auth: false })

  on('GET', '/home', () => catalog.home(USER_ID))
  on('GET', '/stats', () => catalog.getStats(USER_ID))
  on('GET', '/search', ({ query }) => catalog.search(query.q, { limit: query.limit, userId: USER_ID }))
  on('GET', '/library/saved', () => catalog.savedItems(USER_ID))
  on('GET', '/insight/:kind/:id', ({ params }) => {
    if (!['artist', 'album', 'track'].includes(params.kind)) throw new HttpError(400, 'INVALID_KIND', 'Invalid kind.')
    return catalog.insight(params.kind, intParam(params.id), USER_ID)
  })
  on('GET', '/search/history', () => searchHistory.list(USER_ID))
  on('POST', '/search/history', ({ body = {} }) => {
    if (body.q != null) searchHistory.addQuery(USER_ID, body.q)
    if (body.item != null) searchHistory.addItem(USER_ID, body.item)
    return { ok: true }
  })
  on('DELETE', '/search/history', ({ query }) => { searchHistory.remove(USER_ID, { query: query.q ?? null, key: query.key ?? null }); return { ok: true } })
  on('GET', '/genres', ({ query }) => ({ items: catalog.listGenres({ limit: query.limit, userId: USER_ID }) }))
  on('GET', '/tracks', ({ query }) => ({ items: catalog.listTracks({ sort: query.sort, limit: query.limit, offset: query.offset, genre: query.genre, artistId: intParam(query.artistId), favorites: bool(query.favorites), userId: USER_ID }) }))
  on('POST', '/tracks/batch', ({ body }) => ({ items: catalog.getTracksByIds(body?.ids, USER_ID) }))
  on('GET', '/tracks/:id', ({ params }) => {
    const track = catalog.getTrack(intParam(params.id), USER_ID)
    if (!track) throw new HttpError(404, 'NOT_FOUND', 'Track not found.')
    return track
  })
  on('GET', '/tracks/:id/lyrics', async ({ params, query }) => {
    const track = catalog.getTrackRow(intParam(params.id), USER_ID)
    if (!track) throw new HttpError(404, 'NOT_FOUND', 'Track not found.')
    const found = await lyrics.getLyrics(track)
    if (!found) { if (query.soft) return { none: true }; throw new HttpError(404, 'NO_LYRICS', 'No lyrics found.') }
    return found
  })
  on('GET', '/waveform/:id', ({ params }) => {
    const track = catalog.getTrackRow(intParam(params.id), USER_ID)
    if (!track) throw new HttpError(404, 'NOT_FOUND', 'Track not found.')
    return { bins: fakeWaveform(track.id * 7919) }
  })
  on('GET', '/albums', ({ query }) => ({ items: catalog.listAlbums({ sort: query.sort, limit: query.limit, offset: query.offset, artistId: intParam(query.artistId), genre: query.genre, favorites: bool(query.favorites), userId: USER_ID }) }))
  on('GET', '/albums/:id', ({ params }) => {
    const album = catalog.getAlbum(intParam(params.id), USER_ID)
    if (!album) throw new HttpError(404, 'NOT_FOUND', 'Album not found.')
    return album
  })
  on('GET', '/albums/:id/missing', async ({ params }) => {
    const album = catalog.getAlbum(intParam(params.id), USER_ID)
    if (!album) throw new HttpError(404, 'NOT_FOUND', 'Album not found.')
    try { return withPreviews(await discovery.albumMissing(getUser(), album)) } catch { return { available: true, found: false, error: true, missing: [] } }
  })
  on('GET', '/artists', ({ query }) => ({ items: catalog.listArtists({ sort: query.sort, limit: query.limit, offset: query.offset, favorites: bool(query.favorites), userId: USER_ID }) }))
  on('GET', '/artists/:id', ({ params }) => {
    const artist = catalog.getArtist(intParam(params.id), USER_ID)
    if (!artist) throw new HttpError(404, 'NOT_FOUND', 'Artist not found.')
    return artist
  })
  on('GET', '/artists/:id/tracks', ({ params, query }) => {
    const id = intParam(params.id)
    if (!catalog.getArtist(id, USER_ID)) throw new HttpError(404, 'NOT_FOUND', 'Artist not found.')
    return { items: catalog.artistTracks(id, USER_ID, { sort: String(query.sort || 'album'), limit: query.limit, offset: query.offset }) }
  })

  on('GET', '/mixes', () => ({ items: mixes.list(USER_ID) }))
  on('GET', '/mixes/:id', ({ params }) => {
    const mix = mixes.get(USER_ID, decodeURIComponent(params.id))
    if (!mix) throw new HttpError(404, 'NOT_FOUND', 'Mix not found.')
    const { trackIds, ...rest } = mix
    return { ...rest, tracks: catalog.getTracksByIds(trackIds, USER_ID) }
  })
  on('GET', '/mixes/:id/online', async ({ params }) => {
    const mix = mixes.get(USER_ID, decodeURIComponent(params.id))
    if (!mix) throw new HttpError(404, 'NOT_FOUND', 'Mix not found.')
    return withPreviews(await suggestionsFor({ seedIds: mix.trackIds, artists: mix.artists || [], seedKey: `mix:${mix.id}` }))
  })
  on('GET', '/stats/listening', ({ query }) => stats.listening(USER_ID, { range: String(query.range || 'month') }))
  on('GET', '/stats/years', () => ({ items: stats.years(USER_ID) }))
  on('GET', '/stats/wrapped', ({ query }) => stats.wrapped(USER_ID, query.year))

  on('PUT', '/follows/artists', ({ body = {} }) => {
    const result = catalog.followArtistByName(USER_ID, body.name, true)
    if (body.deezerId && result.id) discovery.rememberArtistPhoto?.(result.id, String(body.deezerId)).catch(() => {})
    return result
  })
  on('DELETE', '/follows/artists', ({ query }) => catalog.followArtistByName(USER_ID, query.name, false))
  on('PUT', '/favorites/:type/:id', ({ params }) => catalog.setFavorite(USER_ID, params.type, intParam(params.id), true))
  on('DELETE', '/favorites/:type/:id', ({ params }) => catalog.setFavorite(USER_ID, params.type, intParam(params.id), false))
  on('POST', '/history', ({ body = {} }) => catalog.recordPlay(USER_ID, { trackId: intParam(body.trackId), playedMs: body.playedMs, completed: Boolean(body.completed), context: body.context, deviceId: 'web-demo' }))
  on('GET', '/history/recent', ({ query }) => ({ items: catalog.recentlyPlayed(USER_ID, { limit: query.limit }) }))
  on('GET', '/history/top', ({ query }) => {
    const days = Math.min(Math.max(Number(query.days) || 0, 0), 3650)
    return { items: catalog.mostPlayed(USER_ID, { limit: query.limit, sinceMs: days ? Date.now() - days * 86_400_000 : null }) }
  })

  on('GET', '/playlists', () => ({ items: catalog.listPlaylists(USER_ID) }))
  on('POST', '/playlists', ({ body }) => catalog.createPlaylist(USER_ID, body || {}))
  on('GET', '/playlists/:id', ({ params }) => {
    const pl = catalog.getPlaylist(intParam(params.id), USER_ID)
    return { ...pl, follow: follows.forPlaylist(USER_ID, pl.id) || null }
  })
  on('GET', '/playlists/:id/suggestions', async ({ params, query }) => {
    const pl = catalog.getPlaylist(intParam(params.id), USER_ID)
    const counts = new Map()
    for (const tr of pl.tracks) if (tr.artist) counts.set(tr.artist, (counts.get(tr.artist) || 0) + 1)
    const artists = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name)
    const round = Math.max(0, Math.min(1000, Number.parseInt(query.round, 10) || 0))
    return withPreviews(await suggestionsFor({ seedIds: pl.tracks.map((tr) => tr.id), artists, seedKey: `playlist:${pl.id}:${round}` }))
  })
  on('GET', '/autoplay', async ({ query }) => {
    const ids = (v) => String(v || '').split(',').map((s) => Number.parseInt(s, 10)).filter((n) => n > 0).slice(0, 300)
    const seedIds = ids(query.seed).slice(-20)
    let artist = String(query.artist || '').trim().slice(0, 200)
    if (!artist && seedIds.length) artist = catalog.getTracksByIds(seedIds.slice(-1), USER_ID)[0]?.artist || ''
    let related = { artists: [], trackIds: [] }
    try { if (discovery.autoplayRelated) related = await discovery.autoplayRelated(getUser(), artist) } catch {}
    return { items: catalog.similarTracks(USER_ID, {
      seedIds, excludeIds: ids(query.exclude), artist, genre: String(query.genre || '').trim().slice(0, 100),
      relatedArtists: related.artists, boostIds: related.trackIds, limit: Math.min(30, Number(query.limit) || 15),
      perArtist: 2, seedArtistMax: 3, spread: true, preferHistory: true, fill: true
    }) }
  })
  on('PATCH', '/playlists/:id', ({ params, body }) => catalog.updatePlaylist(intParam(params.id), USER_ID, body || {}))
  on('DELETE', '/playlists/:id', ({ params }) => { catalog.deletePlaylist(intParam(params.id), USER_ID); return { ok: true } })
  on('POST', '/playlists/:id/tracks', ({ params, body }) => catalog.addPlaylistTracks(intParam(params.id), USER_ID, body?.trackIds || []))
  on('DELETE', '/playlists/:id/tracks/:entryId', ({ params }) => catalog.removePlaylistEntry(intParam(params.id), USER_ID, intParam(params.entryId)))
  on('POST', '/playlists/:id/move', ({ params, body }) => catalog.movePlaylistEntry(intParam(params.id), USER_ID, intParam(body?.entryId), body?.toIndex))

  on('GET', '/online/providers', () => ({ providers: online.status(), canDownload: bridge.canDownload(getUser()) }))
  on('GET', '/online/search', async ({ query }) => {
    const kinds = String(query.kinds || 'track,album,artist').split(',').map((k) => k.trim()).filter((k) => ['track', 'album', 'artist', 'playlist'].includes(k))
    const only = query.providers ? String(query.providers).split(',').map((p) => p.trim()) : null
    const result = await online.search(query.q, { kinds: kinds.length ? kinds : ['track'], limit: query.limit, only })
    return withPreviews(annotateOnline(result))
  })
  on('GET', '/discover', async ({ query }) => {
    const scope = ['personal', 'global'].includes(query.scope) ? query.scope : 'all'
    const round = Math.min(Math.max(Math.floor(Number(query.round) || 0), 0), 1000)
    return withPreviews(await discovery.discover(getUser(), { lang: query.lang, scope, round }))
  })
  on('GET', '/discover/moods', () => ({ items: discovery.moods() }))
  on('GET', '/discover/mood/:preset', async ({ params, query }) => withPreviews(await discovery.mood(getUser(), String(params.preset), { lang: query.lang })))
  on('GET', '/online/album', async ({ query }) => {
    const q = onlineQuery(query)
    return withPreviews(await discovery.onlineAlbum(getUser(), { provider: q.provider, id: q.id, url: q.url, artist: q.artist }))
  })
  on('GET', '/online/playlist', async ({ query }) => {
    const q = onlineQuery(query)
    const data = await discovery.onlinePlaylist(getUser(), { provider: q.provider, id: q.id, url: q.url, mix: q.mix })
    return withPreviews({ ...data, follow: q.mix ? null : follows.find(USER_ID, { provider: q.provider, id: q.id, url: q.url }) || null })
  })
  on('GET', '/notifications', ({ query }) => releases.notifications(USER_ID, { limit: query.limit }))
  on('POST', '/notifications/read', ({ body }) => releases.markRead(USER_ID, Array.isArray(body?.ids) ? body.ids : null))
  on('GET', '/releases/settings', () => releases.settings(USER_ID))
  on('PUT', '/releases/settings', ({ body }) => releases.updateSettings(USER_ID, body || {}))
  on('POST', '/releases/check', async () => releases.checkUser(USER_ID, { force: true }))
  on('GET', '/follows/playlists', () => ({ items: follows.list(USER_ID) }))
  on('POST', '/follows/playlists', async ({ body }) => {
    const input = { ...(body || {}) }
    if (input.provider === 'spotify' || input.provider === 'youtube') Object.assign(input, onlineQuery(input))
    return follows.follow(getUser(), input)
  })
  on('DELETE', '/follows/playlists/:id', ({ params }) => follows.unfollow(USER_ID, intParam(params.id)))
  on('POST', '/follows/playlists/:id/sync', async ({ params }) => {
    const own = follows.list(USER_ID).find((f) => f.id === intParam(params.id))
    if (!own) throw new HttpError(404, 'NOT_FOUND', 'Not followed.')
    return follows.sync(own.id)
  })
  on('GET', '/online/artist-mixes', async ({ query }) => withPreviews(await discovery.artistMixes(getUser(), { name: query.name, lang: query.lang })))
  on('GET', '/online/artist-bio', async ({ query }) => ({ bio: await biography.get({ name: query.name, deezerId: query.deezerId, lang: query.lang }) }))
  on('GET', '/online/artist', async ({ query }) => withPreviews(await discovery.onlineArtist(getUser(), { id: deezerIdOf('deezer', query.id) || deezerIdOf('spotify', query.id) || query.id, name: query.name })))
  on('GET', '/online/artist/tracks', async ({ query }) => withPreviews(await discovery.onlineArtistTracks(getUser(), { id: query.id, name: query.name })))
  on('GET', '/online/artist/gaps', async ({ query }) => withPreviews(await discovery.onlineArtistGaps(getUser(), { id: query.id, name: query.name })))

  // Whole store albums: songs already in the library are left out (router.js withAlbumGaps).
  async function withAlbumGaps(item) {
    if (item?.kind !== 'album' || (Array.isArray(item.only) && item.only.length)) return item
    const src = decodeSource(item.url)
    if (!src || src.kind !== 'album') return item
    try {
      const data = await discovery.onlineAlbum(getUser(), { provider: 'deezer', id: src.id })
      const tracks = data?.tracks || []
      const missing = tracks.filter((tr) => !tr.library)
      if (!tracks.length || missing.length === tracks.length) return item
      const only = (missing.length ? missing : tracks).map((tr) => ({ id: tr.id, url: tr.url, title: tr.title, artist: tr.artist, isrc: tr.isrc, duration: tr.duration }))
      return { ...item, only, trackCount: tracks.length }
    } catch { return item }
  }
  on('POST', '/downloads', async ({ body = {} }) => {
    const item = body.force ? (body.item || {}) : await withAlbumGaps(body.item || {})
    return bridge.request(getUser(), item, { playlistId: body.playlistId, force: Boolean(body.force) })
  })
  on('GET', '/downloads', ({ query }) => ({ items: bridge.list(getUser(), { all: bool(query.all), activeOnly: bool(query.active), limit: query.limit, group: query.group ? String(query.group) : null, ungrouped: bool(query.ungrouped) }) }))
  on('POST', '/downloads/groups', async ({ body = {} }) => bridge.requestMany(getUser(), body.items, { title: body.title, artworkUrl: body.artworkUrl, playlistId: body.playlistId }))
  on('GET', '/downloads/groups', ({ query }) => ({ items: bridge.listGroups(getUser(), { all: bool(query.all), activeOnly: bool(query.active), limit: query.limit }) }))
  on('GET', '/downloads/groups/:id', ({ params }) => bridge.getGroup(params.id, getUser()))
  on('POST', '/downloads/groups/:id/cancel', async ({ params }) => bridge.cancelGroup(params.id, getUser()))
  on('POST', '/downloads/groups/:id/retry', ({ params }) => bridge.retryGroup(params.id, getUser()))
  on('GET', '/downloads/:id', ({ params }) => bridge.get(params.id, getUser()))
  on('POST', '/downloads/:id/cancel', async ({ params }) => bridge.cancel(params.id, getUser()))
  on('POST', '/downloads/:id/retry', ({ params }) => bridge.retry(params.id, getUser()))

  on('GET', '/me', () => ({
    user: getUser(),
    permissions: { canDownload: bridge.canDownload(getUser()), libraries: [{ id: 1, name: 'Demo', isDefault: true }] },
    currentDeviceId: 'web-demo',
    devices: []
  }))

  // ---- request handling -----------------------------------------------------------

  let saveTimer = null
  const scheduleSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => persist(), 700) }
  bridge.events.on('update', scheduleSave)
  bridge.events.on('group', scheduleSave)
  window.addEventListener('pagehide', () => { persist() })

  async function handle(method, path, query = {}, body = undefined) {
    const route = routes.find((r) => r.method === method && r.re.test(path))
    if (!route) return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not available in the Gharmonize Player demo.' } } }
    if (route.auth && !signedIn()) return { status: 401, body: { error: { code: 'PLAYER_AUTH_REQUIRED', message: 'Sign in to Gharmonize Player.' } } }
    const m = path.match(route.re)
    const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]))
    try {
      const result = await route.handler({ params, query, body })
      if (method !== 'GET') scheduleSave()
      return { status: method === 'POST' && /^\/(playlists|follows\/playlists)$/.test(path) ? 201 : (path.startsWith('/downloads') && method === 'POST' && !/cancel|retry/.test(path) ? (result?.status === 'exists' ? 200 : 202) : 200), body: result ?? { ok: true } }
    } catch (error) {
      const status = Number(error?.status) || (error?.code ? 400 : 500)
      if (status >= 500) console.error('[demo]', method, path, error)
      else if (!['NO_LYRICS'].includes(error?.code)) console.warn('[demo]', status, method, path, error?.code, error?.message)
      return { status, body: { error: { code: error?.code || 'PLAYER_INTERNAL', message: error?.message || 'Internal player error.' } } }
    }
  }

  // ---- media (audio and artwork URLs → real Deezer URLs) ------------------------

  const ART_SIZES = [250, 500, 1000]
  const sized = (url, size) => {
    const want = ART_SIZES.find((s) => s >= (Number(size) || 500)) || 1000
    return String(url).replace(/\/\d+x\d+-/, `/${want}x${want}-`)
  }

  async function artworkFor(kind, id, size) {
    const albumArt = (albumId) => {
      const row = db.prepare('SELECT rel_path FROM tracks WHERE album_id = ? ORDER BY disc_no, track_no LIMIT 1').get(Number(albumId))
      return row ? getArt(`album:${deezerAlbumOfPath(row.rel_path)}`) : null
    }
    let url = null
    if (kind === 'album') url = albumArt(id)
    else if (kind === 'track') {
      const row = db.prepare('SELECT album_id, rel_path FROM tracks WHERE id = ?').get(Number(id))
      url = row ? getArt(`album:${deezerAlbumOfPath(row.rel_path)}`) : null
    } else if (kind === 'artist') {
      const row = db.prepare('SELECT name FROM artists WHERE id = ?').get(Number(id))
      if (row) {
        const key = `artist:${normalizeKey(row.name)}`
        url = getArt(key)
        if (!url) {
          try { url = await discovery.artistPhotoUrl(row.name) } catch {}
          if (url) setArt(key, url)
        }
      }
    } else if (kind === 'playlist') {
      const row = db.prepare('SELECT t.rel_path FROM playlist_tracks p JOIN tracks t ON t.id = p.track_id WHERE p.playlist_id = ? ORDER BY p.position LIMIT 1').get(Number(id))
      url = row ? getArt(`album:${deezerAlbumOfPath(row.rel_path)}`) : null
    }
    return url ? sized(url, size) : null
  }

  // /api/player/... media URL → the URL the browser should load instead (or null).
  async function resolveMedia(pathname, search = '') {
    let m
    const q = new URLSearchParams(search)
    if ((m = /^\/stream\/(\d+)/.exec(pathname))) {
      const row = catalog.getTrackRow(Number(m[1]), USER_ID)
      const dzId = row && deezerTrackOfPath(row.rel_path)
      return dzId ? freshDeezerPreview(dzId, { fetchImpl: deezerFetch }) : null
    }
    if ((m = /^\/online\/preview\/deezer\/(\d+)/.exec(pathname))) return freshDeezerPreview(m[1], { fetchImpl: deezerFetch })
    if ((m = /^\/artwork\/([a-z]+)\/(\d+)/.exec(pathname))) return artworkFor(m[1], m[2], q.get('size'))
    return null
  }

  return {
    handle,
    resolveMedia,
    events: bridge.events,
    scannerEvents: scanner.events,
    reset: () => { clearSaved(); try { localStorage.removeItem('ghd.jobs.v1'); localStorage.removeItem('ghp.queue.1') } catch {} }
  }
}
