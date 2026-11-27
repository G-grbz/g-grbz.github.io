// Simulated parts of the demo: YouTube / Spotify search answers built from
// Deezer data, and a download "core" that pretends to download and convert
// songs. Nothing is downloaded: a finished job writes virtual files (tags
// only) that the Player's real scanner indexes into the library.
import { deezerGet } from '@player/online.js'
import { BridgeError } from '@player/coreAdapter.js'
import { normalizeKey } from '@player/scanner.js'
import { vfs } from '../shims/node-fs.js'
import { deezerFetch, coverUrl, artistPictureUrl, md5FromImageUrl } from './deezer.js'

export const LIBRARY_ROOT = '/demo/library'
const get = (p) => deezerGet(p, { fetchImpl: deezerFetch })

// ---- simulated source links ----------------------------------------------------
// Fake Spotify / YouTube results keep the Deezer id inside their id, so a
// "download" of them can be resolved again.

export function decodeSource(url) {
  const u = String(url || '')
  let m
  if ((m = /deezer\.com\/(?:[a-z]{2}\/)?(track|album|playlist|artist)\/(\d+)/.exec(u))) return { provider: 'deezer', kind: m[1], id: m[2] }
  if ((m = /open\.spotify\.com\/(track|album|playlist|artist)\/dz[tapr](\d+)/.exec(u))) return { provider: 'spotify', kind: m[1], id: m[2] }
  if ((m = /youtube\.com\/watch\?v=dz(\d+)/.exec(u))) return { provider: 'youtube', kind: 'track', id: m[1] }
  if ((m = /youtube\.com\/browse\/MPREdz(\d+)/.exec(u))) return { provider: 'youtube', kind: 'album', id: m[1] }
  if ((m = /youtube\.com\/playlist\?list=PLdz(\d+)/.exec(u))) return { provider: 'youtube', kind: 'playlist', id: m[1] }
  return null
}

// Online page ids of the simulated providers → Deezer ids.
export function deezerIdOf(provider, id) {
  const s = String(id || '')
  if (provider === 'deezer') return /^\d+$/.test(s) ? s : null
  const m = /^(?:dz[tapr]|MPREdz|PLdz|dz)(\d+)$/.exec(s)
  return m ? m[1] : null
}

// ---- YouTube (Music) search ------------------------------------------------------

export async function youtubeSearch(q, { limit = 12, type = 'track' } = {}) {
  if (type === 'album') {
    const body = await get(`/search/album?q=${encodeURIComponent(q)}&limit=${limit}`)
    return {
      items: (body?.data || []).map((a) => ({
        type: 'album', id: `MPREdz${a.id}`, browseId: `MPREdz${a.id}`, title: a.title, uploader: a.artist?.name,
        thumbnail: a.cover_xl || a.cover_big, webpage_url: `https://music.youtube.com/browse/MPREdz${a.id}`
      }))
    }
  }
  const body = await get(`/search/track?q=${encodeURIComponent(q)}&limit=${limit}`)
  return {
    items: (body?.data || []).map((t) => ({
      type: 'track', id: `dz${t.id}`, title: `${t.artist?.name} - ${t.title}`, track: t.title, artist: t.artist?.name,
      uploader: `${t.artist?.name} - Topic`, duration: t.duration, thumbnail: t.album?.cover_xl || t.album?.cover_big,
      webpage_url: `https://music.youtube.com/watch?v=dz${t.id}`
    }))
  }
}

export async function youtubePlaylistSearch(q, { limit = 12 } = {}) {
  const body = await get(`/search/playlist?q=${encodeURIComponent(q)}&limit=${limit}`)
  return (body?.data || []).map((p) => ({
    type: 'playlist', id: `PLdz${p.id}`, playlistId: `PLdz${p.id}`, title: p.title, uploader: 'YouTube Music',
    thumbnail: p.picture_xl || p.picture_big, webpage_url: `https://music.youtube.com/playlist?list=PLdz${p.id}`
  }))
}

// ---- Spotify Web API client ----------------------------------------------------------

const images = (url) => (url ? [{ url, width: 640, height: 640 }] : [])
const spTrack = (t) => ({
  id: `dzt${t.id}`, name: t.title, artists: [{ name: t.artist?.name }], duration_ms: (Number(t.duration) || 0) * 1000,
  explicit: Boolean(t.explicit_lyrics), album: { name: t.album?.title, images: images(t.album?.cover_xl), release_date: null },
  external_urls: { spotify: `https://open.spotify.com/track/dzt${t.id}` }, external_ids: { isrc: t.isrc || null }
})
const spAlbum = (a) => ({
  id: `dza${a.id}`, name: a.title, artists: [{ name: a.artist?.name }], images: images(a.cover_xl), release_date: a.release_date || null,
  total_tracks: a.nb_tracks, external_urls: { spotify: `https://open.spotify.com/album/dza${a.id}` }
})
const spArtist = (a) => ({ id: `dzr${a.id}`, name: a.name, images: images(a.picture_xl), external_urls: { spotify: `https://open.spotify.com/artist/dzr${a.id}` } })
const spPlaylist = (p) => ({
  id: `dzp${p.id}`, name: p.title, owner: { display_name: p.user?.name || 'Spotify', id: 'user' }, tracks: { total: p.nb_tracks },
  images: images(p.picture_xl), external_urls: { spotify: `https://open.spotify.com/playlist/dzp${p.id}` }
})

export function makeSpotifyClient() {
  const search = async (kind, q, limit) => (await get(`/search/${kind}?q=${encodeURIComponent(q)}&limit=${limit || 12}`))?.data || []
  return {
    searchTracks: async (q, { limit } = {}) => ({ body: { tracks: { items: (await search('track', q, limit)).map(spTrack) } } }),
    searchAlbums: async (q, { limit } = {}) => ({ body: { albums: { items: (await search('album', q, limit)).map(spAlbum) } } }),
    searchArtists: async (q, { limit } = {}) => ({ body: { artists: { items: (await search('artist', q, limit)).map(spArtist) } } }),
    searchPlaylists: async (q, { limit } = {}) => ({ body: { playlists: { items: (await search('playlist', q, limit)).map(spPlaylist) } } })
  }
}

// ---- virtual library files ---------------------------------------------------------

const safe = (s, max = 80) => String(s || 'Unknown').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) || 'Unknown'

// song: { dz, title, artist, artists, album, albumArtist, albumDz, trackNo, discNo, year, genre, duration, isrc, bpm }
export function songPath(song, root = LIBRARY_ROOT) {
  const no = song.trackNo ? `${String(song.trackNo).padStart(2, '0')} - ` : ''
  return `${root}/${safe(song.albumArtist || song.artist)}/${safe(song.album || 'Singles')} [dza${song.albumDz || 0}]/${no}${safe(song.title, 120)} [dz${song.dz}].mp3`
}

export function writeSong(song, { root = LIBRARY_ROOT, mtimeMs } = {}) {
  const abs = songPath(song, root)
  const duration = Number(song.duration) || 180
  vfs.write(abs, {
    common: {
      title: song.title,
      artist: song.artist,
      artists: song.artists || undefined,
      album: song.album || undefined,
      albumartist: song.albumArtist || undefined,
      track: { no: song.trackNo || null },
      disk: { no: song.discNo || null },
      year: song.year || undefined,
      genre: song.genre ? [song.genre] : undefined,
      isrc: song.isrc ? [song.isrc] : undefined,
      bpm: song.bpm || undefined
    },
    format: { duration, bitrate: 320_000, sampleRate: 44_100, numberOfChannels: 2, codec: 'MPEG 1 Layer 3', container: 'MPEG', lossless: false }
  }, { size: Math.round(duration * 40_000), mtimeMs: mtimeMs ?? Date.now() - 60_000 })
  return abs
}

export const parseVirtualFile = async (abs) => {
  const meta = vfs.meta(abs)
  if (!meta) throw new Error('not a demo file')
  return meta
}

export const deezerTrackOfPath = (relOrAbs) => /\[dz(\d+)\]\.[a-z0-9]+$/i.exec(String(relOrAbs || ''))?.[1] || null
export const deezerAlbumOfPath = (relOrAbs) => /\[dza(\d+)\]\//.exec(String(relOrAbs || ''))?.[1] || null

// ---- fake download core ------------------------------------------------------------

const JOBS_KEY = 'ghd.jobs.v1'
const PREPARE_MS = 1400
const PER_SONG_MS = 2100

const fold = (t) => normalizeKey(t).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

function mapTrack(t, album = null) {
  const alb = album || t.album || {}
  return {
    dz: String(t.id),
    title: t.title,
    artist: t.artist?.name || alb.artist?.name || '',
    album: alb.title || null,
    albumArtist: alb.artist?.name || t.artist?.name || null,
    albumDz: alb.id || null,
    cover: alb.md5_image || md5FromImageUrl(alb.cover_xl || alb.cover_big || alb.cover) || null,
    artistPicture: t.artist?.md5_image || md5FromImageUrl(t.artist?.picture_xl) || null,
    trackNo: t.track_position || null,
    discNo: t.disk_number || null,
    year: Number(String(alb.release_date || t.release_date || '').slice(0, 4)) || null,
    genre: alb.genres?.data?.[0]?.name || null,
    duration: Number(t.duration) || null,
    isrc: t.isrc || null
  }
}

async function resolveSongs(source) {
  if (source.kind === 'track') {
    const t = await get(`/track/${source.id}`)
    let album = null
    try { album = t.album?.id ? await get(`/album/${t.album.id}`) : null } catch {}
    return { title: t.title, songs: [mapTrack(t, album || t.album)] }
  }
  if (source.kind === 'album') {
    const album = await get(`/album/${source.id}`)
    const list = await get(`/album/${source.id}/tracks?limit=500`)
    return { title: album.title, songs: (list?.data || album.tracks?.data || []).map((t) => mapTrack(t, album)) }
  }
  if (source.kind === 'playlist') {
    const pl = await get(`/playlist/${source.id}`)
    const list = await get(`/playlist/${source.id}/tracks?limit=100`)
    return { title: pl.title, songs: (list?.data || []).map((t) => mapTrack(t)) }
  }
  throw new BridgeError('UNSUPPORTED_SOURCE', 'This link cannot be downloaded into the library.', { permanent: true })
}

function pickOnly(songs, only) {
  if (!only?.length) return songs
  const isrcs = new Set(only.map((s) => String(s.isrc || '').toUpperCase()).filter(Boolean))
  const ids = new Set(only.map((s) => decodeSource(s.url)?.id || (/^\d+$/.test(String(s.id || '')) ? String(s.id) : null)).filter(Boolean))
  const keys = new Set(only.map((s) => `${fold(s.title)}|${fold(String(s.artist || '').split(/,|&| feat/i)[0])}`))
  return songs.filter((s) => ids.has(s.dz) || (s.isrc && isrcs.has(s.isrc.toUpperCase())) || keys.has(`${fold(s.title)}|${fold(String(s.artist || '').split(/,|&| feat/i)[0])}`))
}

export function createFakeCore({ onArt = () => {}, now = () => Date.now() } = {}) {
  let jobs = {}
  try { jobs = JSON.parse(localStorage.getItem(JOBS_KEY) || '{}') || {} } catch {}
  const save = () => { try { localStorage.setItem(JOBS_KEY, JSON.stringify(jobs)) } catch {} }
  // Finished jobs are only needed while the bridge picks up their files.
  for (const [id, job] of Object.entries(jobs)) if (now() - job.start > 2 * 86_400_000) delete jobs[id]
  save()

  async function inspect(url) {
    const source = decodeSource(url)
    if (!source || source.kind === 'artist') throw new BridgeError('UNSUPPORTED_SOURCE', 'This link cannot be downloaded into the library.', { permanent: true })
    return { provider: source.provider, url, isPlaylist: source.kind !== 'track' }
  }

  async function createAndEnqueue({ url, only = null, isCanceled }) {
    const info = await inspect(url)
    const source = decodeSource(url)
    let resolved
    try { resolved = await resolveSongs(source) } catch (error) {
      if (error instanceof BridgeError) throw error
      throw new BridgeError('SOURCE_RESOLVE_FAILED', String(error?.message || error).slice(0, 300))
    }
    const songs = pickOnly(resolved.songs, only)
    if (!songs.length) throw new BridgeError(only?.length ? 'NOTHING_TO_DOWNLOAD' : 'SOURCE_EMPTY', 'None of the songs were found in this source.', { permanent: true })
    if (isCanceled?.()) throw new BridgeError('DOWNLOAD_CANCELED', 'The download was canceled.')
    const jobId = `demo-${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    jobs[jobId] = { songs, start: now(), canceled: false, written: null }
    save()
    return { jobId, provider: info.provider }
  }

  async function getJob(jobId) {
    const job = jobs[jobId]
    if (!job) return null
    if (job.canceled) return { status: 'canceled', progress: 0, phase: 'canceled', steps: null, error: null, outputs: [] }
    const n = job.songs.length
    const total = PREPARE_MS + n * PER_SONG_MS
    const elapsed = now() - job.start
    if (elapsed >= total) {
      if (!job.written) {
        job.written = job.songs.map((song) => {
          if (song.cover && song.albumDz) onArt(`album:${song.albumDz}`, coverUrl(song.cover))
          if (song.artistPicture) onArt(`artist:${normalizeKey(song.artist)}`, artistPictureUrl(song.artistPicture))
          return writeSong(song, { root: `${LIBRARY_ROOT}/Downloads`, mtimeMs: now() - 1000 })
        })
        save()
      } else {
        // After a reload the virtual files are gone: write them again.
        job.songs.forEach((song) => writeSong(song, { root: `${LIBRARY_ROOT}/Downloads`, mtimeMs: now() - 1000 }))
      }
      return { status: 'completed', progress: 100, phase: null, steps: null, error: null, outputs: job.written }
    }
    if (elapsed < PREPARE_MS) return { status: 'running', progress: 1, phase: 'preparing', steps: n > 1 ? { total: n, downloaded: 0, converted: 0 } : null, error: null, outputs: [] }
    const songTime = elapsed - PREPARE_MS
    const index = Math.floor(songTime / PER_SONG_MS)
    const within = (songTime % PER_SONG_MS) / PER_SONG_MS
    const converting = within > 0.7
    return {
      status: 'running',
      progress: Math.min(99, (elapsed / total) * 100),
      phase: converting ? 'converting' : 'downloading',
      steps: n > 1 ? { total: n, downloaded: Math.min(n, index + (converting ? 1 : 0)), converted: Math.min(n, index) } : null,
      error: null,
      outputs: []
    }
  }

  async function cancel(jobId) {
    if (jobs[jobId] && !jobs[jobId].written) { jobs[jobId].canceled = true; save() }
  }

  async function cleanupJob(jobId) {
    setTimeout(() => { delete jobs[jobId]; save() }, 10_000)
    return true
  }

  return { inspect, createAndEnqueue, getJob, cancel, cleanupJob, findAlternative: async () => null, mappedLinks: async () => [] }
}
