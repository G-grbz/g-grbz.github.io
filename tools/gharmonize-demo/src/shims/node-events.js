export class EventEmitter {
  constructor() { this._l = new Map() }
  setMaxListeners() { return this }
  on(e, fn) { if (!this._l.has(e)) this._l.set(e, new Set()); this._l.get(e).add(fn); return this }
  addListener(e, fn) { return this.on(e, fn) }
  once(e, fn) { const w = (...a) => { this.off(e, w); fn(...a) }; return this.on(e, w) }
  off(e, fn) { this._l.get(e)?.delete(fn); return this }
  removeListener(e, fn) { return this.off(e, fn) }
  removeAllListeners(e) { if (e) this._l.delete(e); else this._l.clear(); return this }
  emit(e, ...a) {
    const set = this._l.get(e)
    if (!set?.size) return false
    for (const fn of [...set]) { try { fn(...a) } catch (error) { console.error('[demo] event handler failed', e, error) } }
    return true
  }
  listenerCount(e) { return this._l.get(e)?.size || 0 }
}
export default { EventEmitter }
