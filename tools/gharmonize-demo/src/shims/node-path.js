// Minimal POSIX path module for the in-browser demo server.
function normalizeParts(parts, absolute) {
  const out = []
  for (const p of parts) {
    if (!p || p === '.') continue
    if (p === '..') { if (out.length && out[out.length - 1] !== '..') out.pop(); else if (!absolute) out.push('..') } else out.push(p)
  }
  return out
}
export const sep = '/'
export const delimiter = ':'
export function isAbsolute(p) { return String(p).startsWith('/') }
export function normalize(p) {
  p = String(p)
  const abs = isAbsolute(p)
  const s = normalizeParts(p.split('/'), abs).join('/')
  return (abs ? '/' : '') + (s || (abs ? '' : '.'))
}
export function join(...parts) { return normalize(parts.filter((x) => x !== '').join('/')) }
export function resolve(...parts) {
  let r = ''
  for (let i = parts.length - 1; i >= 0 && !isAbsolute(r); i--) r = parts[i] ? `${parts[i]}/${r}` : r
  if (!isAbsolute(r)) r = `/${r}`
  return normalize(r).replace(/(.)\/$/, '$1')
}
export function relative(from, to) {
  const a = resolve(from).split('/').filter(Boolean)
  const b = resolve(to).split('/').filter(Boolean)
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/')
}
export function dirname(p) { const s = String(p).replace(/\/+$/, ''); const i = s.lastIndexOf('/'); return i < 0 ? '.' : i === 0 ? '/' : s.slice(0, i) }
export function basename(p, ext) { let b = String(p).replace(/\/+$/, '').split('/').pop() || ''; if (ext && b.endsWith(ext)) b = b.slice(0, -ext.length); return b }
export function extname(p) { const b = basename(p); const i = b.lastIndexOf('.'); return i <= 0 ? '' : b.slice(i) }
export function parse(p) { const base = basename(p); const ext = extname(p); return { root: isAbsolute(p) ? '/' : '', dir: dirname(p), base, ext, name: ext ? base.slice(0, -ext.length) : base } }
const path = { sep, delimiter, isAbsolute, normalize, join, resolve, relative, dirname, basename, extname, parse }
path.posix = path
export const posix = path
export default path
