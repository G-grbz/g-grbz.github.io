// Builds data/library.json: the demo's starting music library, taken from the
// public Deezer API (metadata only — audio is always the 30 s Deezer preview).
// Run: npm run fetch-library
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(here, '../data/library.json')

// [artist, album] searched on Deezer; the first exact artist match is used.
const ALBUMS = [
  ['Daft Punk', 'Random Access Memories'],
  ['The Weeknd', 'After Hours'],
  ['Dua Lipa', 'Future Nostalgia'],
  ['Coldplay', 'A Rush of Blood to the Head'],
  ['Queen', 'A Night At The Opera'],
  ['Arctic Monkeys', 'AM'],
  ['Billie Eilish', 'Happier Than Ever'],
  ['Adele', '21'],
  ['Tarkan', 'Karma'],
  ['Duman', 'Belki Alışman Lazım'],
  ['maNga', 'maNga'],
  ['Sezen Aksu', 'Gülümse'],
  ['Mor ve Ötesi', 'Dünya Yalan Söylüyor'],
  ['Barış Manço', 'Sözüm Meclisten Dışarı']
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let last = 0
async function dz(pathAndQuery) {
  const wait = 130 - (Date.now() - last)
  if (wait > 0) await sleep(wait)
  last = Date.now()
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://api.deezer.com${pathAndQuery}`)
    const body = await res.json()
    if (body?.error?.code === 4) { await sleep(2000); continue } // quota
    if (body?.error) throw new Error(`${pathAndQuery}: ${body.error.message}`)
    return body
  }
  throw new Error(`${pathAndQuery}: quota`)
}

const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').toLowerCase().trim()

async function findAlbum(artist, title) {
  const res = await dz(`/search/album?q=${encodeURIComponent(`${artist} ${title}`)}&limit=25`)
  const list = res.data || []
  return list.find((a) => fold(a.artist?.name) === fold(artist) && fold(a.title) === fold(title))
    || list.find((a) => fold(a.artist?.name) === fold(artist) && fold(a.title).startsWith(fold(title)))
    || list.find((a) => fold(a.artist?.name) === fold(artist))
}

const albums = []
const artists = new Map()
for (const [artistName, albumTitle] of ALBUMS) {
  const hit = await findAlbum(artistName, albumTitle)
  if (!hit) { console.warn(`! not found: ${artistName} – ${albumTitle}`); continue }
  const album = await dz(`/album/${hit.id}`)
  const year = Number(String(album.release_date || '').slice(0, 4)) || null
  const genre = album.genres?.data?.[0]?.name || null
  const tracks = []
  for (const brief of album.tracks?.data || []) {
    const t = await dz(`/track/${brief.id}`)
    if (!t.readable || !t.preview) continue
    const main = (t.contributors || []).filter((c) => c.role === 'Main' || !c.role)
    const names = main.length ? main.map((c) => c.name) : [t.artist?.name]
    for (const c of main.length ? main : [t.artist]) {
      if (c?.id && !artists.has(c.id)) artists.set(c.id, { id: c.id, name: c.name, picture: c.md5_image || null })
    }
    tracks.push({
      dz: t.id,
      title: t.title,
      artist: names.join(', '),
      artists: names.length > 1 ? names : null,
      trackNo: t.track_position || null,
      discNo: t.disk_number || 1,
      duration: t.duration,
      isrc: t.isrc || null,
      bpm: t.bpm || null
    })
  }
  if (!tracks.length) continue
  if (album.artist?.id && !artists.has(album.artist.id)) artists.set(album.artist.id, { id: album.artist.id, name: album.artist.name, picture: album.artist.md5_image || null })
  albums.push({ dz: album.id, title: album.title, artist: album.artist?.name, year, genre, cover: album.md5_image, tracks })
  console.log(`✓ ${album.artist?.name} – ${album.title} (${tracks.length} songs, ${year}, ${genre})`)
}

// Artist pictures (md5) — the search payload above has them for contributors.
for (const a of artists.values()) {
  if (a.picture) continue
  try { a.picture = (await dz(`/artist/${a.id}`)).md5_image || null } catch {}
}

await fs.mkdir(path.dirname(OUT), { recursive: true })
await fs.writeFile(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), albums, artists: [...artists.values()] }))
console.log(`→ ${OUT}: ${albums.length} albums, ${albums.reduce((n, a) => n + a.tracks.length, 0)} songs, ${artists.size} artists`)
