// The Player's default settings (modules/player/service.js DEFAULT_CONFIG),
// with the providers the demo can offer.
export const DEFAULT_CONFIG = Object.freeze({
  serverName: 'Gharmonize Player',
  scanIntervalMinutes: 0,
  transcodeCacheMb: 0,
  onlineLyrics: true,
  downloadsEnabled: true,
  downloadFormat: 'mp3',
  downloadBitrate: '320k',
  downloadLyrics: true,
  maxParallelDownloads: 2,
  maxQueuedPerUser: 50,
  onlineProviders: ['deezer', 'youtube', 'spotify'],
  providersRev: 2,
  discoveryEnabled: true,
  publicUrls: []
})
