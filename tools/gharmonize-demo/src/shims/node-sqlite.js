// node:sqlite (DatabaseSync / StatementSync) on top of the official SQLite
// WebAssembly build, for the Gharmonize Player server modules running in the
// browser. The database lives in memory; persist() stores a gzip-compressed
// copy in localStorage so favorites, playlists and history survive reloads.

const STORAGE_KEY = 'ghd.db.v1'
let sqlite3 = null
let savedBytes = null
let current = null

export async function initSqlite(init, { locateFile }) {
  sqlite3 = await init({ locateFile, print: () => {}, printErr: (...a) => console.warn('[sqlite]', ...a) })
  savedBytes = await loadSaved()
  return sqlite3
}

export function hasSavedDatabase() { return Boolean(savedBytes) }

async function gzip(bytes, mode) {
  const stream = new Blob([bytes]).stream().pipeThrough(mode === 'c' ? new CompressionStream('gzip') : new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function toBase64(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function fromBase64(text) {
  const bin = atob(text)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return await gzip(fromBase64(raw), 'd')
  } catch (error) {
    console.warn('[demo] saved library could not be read, starting fresh', error)
    return null
  }
}

let saving = null
let again = false
export function persist() {
  if (!current) return Promise.resolve()
  if (saving) { again = true; return saving }
  saving = (async () => {
    try {
      const bytes = sqlite3.capi.sqlite3_js_db_export(current.raw.pointer)
      const packed = await gzip(bytes, 'c')
      localStorage.setItem(STORAGE_KEY, toBase64(packed))
    } catch (error) {
      console.warn('[demo] library could not be saved', error)
    } finally {
      saving = null
      if (again) { again = false; persist() }
    }
  })()
  return saving
}

export function clearSaved() {
  try { localStorage.removeItem(STORAGE_KEY) } catch {}
}

function value(v) {
  if (v === undefined) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  return v
}

function row(v) {
  if (!v) return v
  for (const k in v) if (typeof v[k] === 'bigint') v[k] = Number(v[k])
  return v
}

export class StatementSync {
  constructor(db, sql) {
    this.db = db
    this.sql = sql
    this.stmt = db.raw.prepare(sql)
  }

  bindArgs(args) {
    const s = this.stmt
    s.reset(true)
    if (!args.length || !s.parameterCount) return
    let rest = args
    const first = args[0]
    if (first && typeof first === 'object' && !Array.isArray(first) && !(first instanceof Uint8Array)) {
      for (const [key, v] of Object.entries(first)) {
        const name = /^[$:@?]/.test(key) ? key : `$${key}`
        const index = s.getParamIndex(name) || s.getParamIndex(`:${key.replace(/^[$:@]/, '')}`) || s.getParamIndex(`@${key.replace(/^[$:@]/, '')}`)
        if (index) s.bind(index, value(v))
      }
      rest = args.slice(1)
    }
    rest.forEach((v, i) => s.bind(i + 1, value(v)))
  }

  get(...args) {
    this.bindArgs(args)
    try {
      return this.stmt.step() ? row(this.stmt.get({})) : undefined
    } finally { this.stmt.reset() }
  }

  all(...args) {
    this.bindArgs(args)
    const out = []
    try {
      while (this.stmt.step()) out.push(row(this.stmt.get({})))
    } finally { this.stmt.reset() }
    return out
  }

  *iterate(...args) {
    yield* this.all(...args)
  }

  run(...args) {
    this.bindArgs(args)
    try {
      while (this.stmt.step()) { /* drain */ }
    } finally { this.stmt.reset() }
    this.db.dirty = true
    const capi = sqlite3.capi
    return { changes: Number(capi.sqlite3_changes(this.db.raw.pointer)), lastInsertRowid: Number(capi.sqlite3_last_insert_rowid(this.db.raw.pointer)) }
  }
}

export class DatabaseSync {
  constructor() {
    if (!sqlite3) throw new Error('SQLite is not initialized')
    this.raw = new sqlite3.oo1.DB(':memory:', 'c')
    this.cache = new Map()
    this.dirty = false
    if (savedBytes) {
      const bytes = savedBytes
      savedBytes = null
      const p = sqlite3.wasm.allocFromTypedArray(bytes)
      const capi = sqlite3.capi
      const rc = capi.sqlite3_deserialize(this.raw.pointer, 'main', p, bytes.byteLength, bytes.byteLength,
        capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_RESIZEABLE)
      this.raw.checkRc(rc)
    }
    current = this
  }

  prepare(sql) {
    let stmt = this.cache.get(sql)
    if (!stmt) {
      stmt = new StatementSync(this, sql)
      this.cache.set(sql, stmt)
    }
    return stmt
  }

  exec(sql) {
    this.raw.exec(sql)
    if (!/^\s*(PRAGMA [a-z_]+\s*$|SELECT)/i.test(sql)) this.dirty = true
  }

  close() {
    for (const s of this.cache.values()) { try { s.stmt.finalize() } catch {} }
    this.cache.clear()
    this.raw.close()
    if (current === this) current = null
  }
}

export default { DatabaseSync, StatementSync }
