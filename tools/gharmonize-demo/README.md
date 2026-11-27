# Gharmonize Player demo (GitHub Pages)

Builds `demo/gharmonize/` of this site: the real Gharmonize Player running in the
browser with no backend. The Gharmonize repository is only read, never changed.

## Rebuild

```sh
cd tools/gharmonize-demo
npm install
npm run build                 # reads ../../../Gharmonize (or set GHARMONIZE_DIR)
npm run fetch-library         # optional: refresh data/library.json from Deezer
```

Serve the site root locally (`python3 -m http.server 8765`) and open
http://127.0.0.1:8765/demo/gharmonize/. A Service Worker is required, so use
`localhost`/`127.0.0.1` or HTTPS.

## How it works

- **Web client:** `public/player` is copied unchanged, apart from `PATCHES` in
  `build.mjs` (the device pairing and password cards are removed from the account page).
- **Server:** the Player's own server modules (`modules/player`: catalog, mixes,
  statistics, search history, discovery, download bridge, scanner, follows,
  releases, lyrics, biography) are bundled with esbuild. `src/shims` stands in for
  Node: `node:sqlite` runs on SQLite WebAssembly, and `node:fs` is a small virtual
  file system. `src/server/index.js` mirrors the user routes of `router.js`.
  Administration, pairing and CD ripping are left out.
- **Data:** the database lives in memory. After each change a gzip copy is saved in
  `localStorage` (`ghd.db.v1`, about 250 KB). On the first visit, a library of 14
  albums (`data/library.json`) is indexed by the real scanner, with listening
  history, favorites and two playlists.
- **Audio and covers:** `sw.js` answers `/api/player/stream|artwork|online/preview`.
  Audio is redirected to a fresh 30-second Deezer preview. Covers are passed through
  same-origin, so the Player can read their colours. Deezer's API is reached with
  JSONP, because it sends no CORS headers.
- **Simulations:** YouTube and Spotify search results are built from Deezer data,
  with the Deezer id kept in their ids. Downloads go through the real download
  bridge with a fake core (`src/server/sim.js`): it shows preparing, downloading
  and converting progress, then writes virtual files that the scanner indexes. No
  file is ever downloaded, and the demo says so (Demo chip, toasts, a note on the
  downloads page).
