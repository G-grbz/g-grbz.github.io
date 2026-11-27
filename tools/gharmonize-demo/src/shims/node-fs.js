// A tiny virtual file system: the demo library and simulated downloads are
// "files" whose tags live in memory. Only what the Player scanner, the
// download bridge and the lyrics service touch is implemented.
import path from './node-path.js'

const files = new Map() // abs path → { size, mtimeMs, meta }

export const vfs = {
  write(abs, meta, { size = 4_000_000, mtimeMs = Date.now() - 60_000 } = {}) {
    files.set(path.resolve(abs), { size, mtimeMs, meta })
  },
  meta(abs) { return files.get(path.resolve(abs))?.meta || null },
  has(abs) { return files.has(path.resolve(abs)) },
  remove(abs) { files.delete(path.resolve(abs)) },
  list() { return [...files.keys()] }
}

function enoent(p) {
  const e = new Error(`ENOENT: no such file or directory, '${p}'`)
  e.code = 'ENOENT'
  return e
}

function isDir(abs) {
  const prefix = abs.endsWith('/') ? abs : `${abs}/`
  for (const k of files.keys()) if (k.startsWith(prefix)) return true
  return abs === '/'
}

function statOf(p) {
  const abs = path.resolve(p)
  const f = files.get(abs)
  if (f) return { size: f.size, mtimeMs: f.mtimeMs, mtime: new Date(f.mtimeMs), isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false }
  if (isDir(abs)) return { size: 0, mtimeMs: 0, mtime: new Date(0), isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false }
  throw enoent(p)
}

function entries(p) {
  const abs = path.resolve(p)
  const prefix = abs === '/' ? '/' : `${abs}/`
  const seen = new Map()
  for (const k of files.keys()) {
    if (!k.startsWith(prefix)) continue
    const rest = k.slice(prefix.length)
    const name = rest.split('/')[0]
    if (!seen.has(name)) seen.set(name, rest.includes('/'))
  }
  return [...seen].map(([name, dir]) => ({ name, isDirectory: () => dir, isFile: () => !dir, isSymbolicLink: () => false }))
}

export const constants = { R_OK: 4, W_OK: 2, X_OK: 1, F_OK: 0, O_RDONLY: 0, O_NONBLOCK: 2048 }

export const promises = {
  async stat(p) { return statOf(p) },
  async lstat(p) { return statOf(p) },
  async realpath(p) { statOf(p); return path.resolve(p) },
  async access(p) { statOf(p) },
  async opendir(p) {
    if (!isDir(path.resolve(p))) throw enoent(p)
    const list = entries(p)
    return { async *[Symbol.asyncIterator]() { yield* list }, async close() {} }
  },
  async readdir(p, opts) { const list = entries(p); return opts?.withFileTypes ? list : list.map((e) => e.name) },
  async open(p) { throw enoent(p) },
  async readFile(p) { throw enoent(p) },
  async writeFile() {},
  async mkdir() {},
  async rmdir() {},
  async rm() {},
  async unlink(p) { files.delete(path.resolve(p)) },
  async rename(a, b) { const f = files.get(path.resolve(a)); if (!f) throw enoent(a); files.delete(path.resolve(a)); files.set(path.resolve(b), f) },
  async copyFile() {}
}

export function existsSync(p) { try { statOf(p); return true } catch { return false } }
export function statSync(p) { return statOf(p) }
export function mkdirSync() {}
export function readFileSync(p) { throw enoent(p) }
export function writeFileSync() {}
export function chmodSync() {}
export function realpathSync(p) { statOf(p); return path.resolve(p) }
export function accessSync(p) { statOf(p) }

export default { promises, constants, existsSync, statSync, mkdirSync, readFileSync, writeFileSync, chmodSync, realpathSync, accessSync }
