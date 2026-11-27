// `process` for server modules that read the environment (Spotify search is
// "configured" so the simulated Spotify provider is used).
import { EventEmitter } from './node-events.js'
const emitter = new EventEmitter()
export const process = {
  env: {
    SPOTIFY_CLIENT_ID: 'demo',
    SPOTIFY_CLIENT_SECRET: 'demo',
    SPOTIFY_MARKET: 'TR',
    SPOTIFY_FALLBACK_MARKETS: 'US,GB,DE'
  },
  platform: 'browser',
  versions: {},
  cwd: () => '/',
  on: (...a) => emitter.on(...a),
  off: (...a) => emitter.off(...a),
  emit: (...a) => emitter.emit(...a),
  nextTick: (fn, ...a) => queueMicrotask(() => fn(...a))
}
