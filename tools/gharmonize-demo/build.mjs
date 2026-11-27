// Builds the Gharmonize Player demo into <portal>/demo/gharmonize/.
// The Gharmonize repository is only read. Set GHARMONIZE_DIR to use another checkout.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const here = path.dirname(fileURLToPath(import.meta.url))
const GH = path.resolve(process.env.GHARMONIZE_DIR || path.join(here, '../../../Gharmonize'))
const PLAYER = path.join(GH, 'modules/player')
const OUT = path.resolve(here, '../../demo/gharmonize')
const version = JSON.parse(await fs.readFile(path.join(GH, 'package.json'), 'utf8')).version

// Changes to the copied Player files. Each must match exactly once.
const PATCHES = {
  'player/js/views/account.js': [
    // No device pairing or password change in the demo.
    ['cards.append(releasesCard(perms), devicesCard(me), passwordCard())', 'cards.append(releasesCard(perms))']
  ]
}

async function copyDir(from, to, filter = () => true) {
  await fs.mkdir(to, { recursive: true })
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const a = path.join(from, entry.name)
    const b = path.join(to, entry.name)
    if (!filter(a, entry)) continue
    if (entry.isDirectory()) await copyDir(a, b, filter)
    else await fs.copyFile(a, b)
  }
}

await fs.rm(OUT, { recursive: true, force: true })
await fs.mkdir(path.join(OUT, 'demo'), { recursive: true })

// 1. The Player web client, unchanged apart from PATCHES.
await copyDir(path.join(GH, 'public/player'), path.join(OUT, 'player'), (p) => path.basename(p) !== 'index.html')
await copyDir(path.join(GH, 'public/lang'), path.join(OUT, 'lang'))
await fs.copyFile(path.join(GH, 'public/i18n.js'), path.join(OUT, 'i18n.js'))
await fs.mkdir(path.join(OUT, 'src'), { recursive: true })
for (const f of ['logo.png', 'favicon.ico']) await fs.copyFile(path.join(GH, 'public/src', f), path.join(OUT, 'src', f))
for (const [file, list] of Object.entries(PATCHES)) {
  const abs = path.join(OUT, file)
  let text = await fs.readFile(abs, 'utf8')
  for (const [from, to] of list) {
    const count = text.split(from).length - 1
    if (count !== 1) throw new Error(`Patch for ${file} matched ${count} times: ${from}`)
    text = text.replace(from, to)
  }
  await fs.writeFile(abs, text)
}

// 2. The Player server modules, bundled for the browser.
const shim = (name) => path.join(here, 'src/shims', name)
const STUBS = path.join(here, 'src/stubs')
const nodeShims = {
  'node:fs': shim('node-fs.js'), fs: shim('node-fs.js'), 'node:fs/promises': shim('node-fs.js'),
  'node:path': shim('node-path.js'), path: shim('node-path.js'),
  'node:crypto': shim('node-crypto.js'), crypto: shim('node-crypto.js'),
  'node:events': shim('node-events.js'), events: shim('node-events.js'),
  'node:sqlite': shim('node-sqlite.js')
}
const playerStub = { 'paths.js': 'paths.js', 'auth.js': 'auth.js' }

const resolver = {
  name: 'gharmonize-demo',
  setup(b) {
    b.onResolve({ filter: /^@player\// }, (args) => ({ path: path.join(PLAYER, args.path.slice('@player/'.length)) }))
    b.onResolve({ filter: /^(node:)?(fs|fs\/promises|path|crypto|events|sqlite)$/ }, (args) => ({ path: nodeShims[args.path] || nodeShims[`node:${args.path}`] }))
    b.onResolve({ filter: /^music-metadata$/ }, () => ({ path: path.join(STUBS, 'empty.js') }))
    b.onResolve({ filter: /^\.\.?\// }, (args) => {
      if (!args.importer.startsWith(PLAYER)) return null
      const target = path.resolve(path.dirname(args.importer), args.path)
      const rel = path.relative(PLAYER, target)
      if (playerStub[rel]) return { path: path.join(STUBS, playerStub[rel]) }
      // Parts of Gharmonize outside the Player (downloader, YouTube, Spotify …) are not part of the demo.
      if (rel.startsWith('..') && !/youtubeIdentity\.js$/.test(rel)) return { path: path.join(STUBS, 'empty.js') }
      return null
    })
  }
}

const result = await esbuild.build({
  entryPoints: [path.join(here, 'src/server/index.js')],
  outfile: path.join(OUT, 'demo/server.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  inject: [shim('process.js')],
  define: { __GHARMONIZE_VERSION__: JSON.stringify(version) },
  loader: { '.json': 'json' },
  plugins: [resolver],
  metafile: true,
  logLevel: 'warning'
})
await fs.copyFile(path.join(here, 'node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm'), path.join(OUT, 'demo/sqlite3.wasm'))

// 3. Demo shell: page, Service Worker, bootstrap.
const tpl = (s) => s.replaceAll('__VERSION__', version)
await fs.writeFile(path.join(OUT, 'index.html'), tpl(await fs.readFile(path.join(here, 'src/client/index.html'), 'utf8')))
await fs.writeFile(path.join(OUT, 'sw.js'), tpl(await fs.readFile(path.join(here, 'src/client/sw.js'), 'utf8')))
for (const f of ['bootstrap.js', 'demo.css']) await fs.copyFile(path.join(here, 'src/client', f), path.join(OUT, 'demo', f))

const bytes = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0)
console.log(`✓ Gharmonize Player ${version} demo → ${path.relative(process.cwd(), OUT)} (server bundle ${(bytes / 1024).toFixed(0)} KB)`)
