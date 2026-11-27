// Deezer's public API sends no CORS header, but answers JSONP. This module
// gives the Player's server code a fetch()-like function for it.

let seq = 0
const memo = new Map()
const MEMO_MS = 5 * 60 * 1000

export function jsonp(url, { timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const cb = `__ghdDeezer${++seq}`
    const u = new URL(url)
    u.searchParams.set('output', 'jsonp')
    u.searchParams.set('callback', cb)
    const script = document.createElement('script')
    let done = false
    const finish = () => {
      done = true
      clearTimeout(timer)
      window[cb] = () => {}
      setTimeout(() => { delete window[cb] }, 30_000)
      script.remove()
    }
    const timer = setTimeout(() => { if (!done) { finish(); reject(new Error('Deezer did not answer in time.')) } }, timeoutMs)
    window[cb] = (data) => { if (!done) { finish(); resolve(data) } }
    script.onerror = () => { if (!done) { finish(); reject(new Error('Deezer could not be reached.')) } }
    script.src = u.toString()
    document.head.append(script)
  })
}

function response(data) {
  return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) }
}

// fetch(url) for https://api.deezer.com/… (track answers are not memoized:
// they carry the short-lived preview links).
export async function deezerFetch(url) {
  const key = String(url)
  const cacheable = !/\/track\/\d+(?:[?#]|$)/.test(key)
  const hit = cacheable && memo.get(key)
  if (hit && Date.now() - hit.at < MEMO_MS) return response(hit.data)
  const data = await jsonp(key)
  if (cacheable && !data?.error) {
    memo.set(key, { at: Date.now(), data })
    if (memo.size > 400) memo.delete(memo.keys().next().value)
  }
  return response(data)
}

// Direct helper for the demo's own code (same rate limit as the Player's).
export async function dz(pathAndQuery) {
  const res = await deezerFetch(`https://api.deezer.com${pathAndQuery}`)
  const body = await res.json()
  if (body?.error) throw new Error(`Deezer: ${body.error.message || 'error'}`)
  return body
}

export const coverUrl = (md5, size = 500) => (md5 ? `https://cdn-images.dzcdn.net/images/cover/${md5}/${size}x${size}-000000-80-0-0.jpg` : null)
export const artistPictureUrl = (md5, size = 500) => (md5 ? `https://cdn-images.dzcdn.net/images/artist/${md5}/${size}x${size}-000000-80-0-0.jpg` : null)
export function md5FromImageUrl(url) {
  const m = /\/images\/(?:cover|artist)\/([0-9a-f]{32})\//.exec(String(url || ''))
  return m ? m[1] : null
}
