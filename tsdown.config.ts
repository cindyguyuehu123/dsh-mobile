/**
 * dsh-mobile tsdown config: one run emits both halves.
 *
 * Node half (lib/index.js): the host loader entry — LAN reverse proxy, PWA
 * index taps, icon/manifest/mobile-page routes. Deliberately dependency-light:
 * the only value import is 'qrcode'; cordis/webserver appear as local
 * structural types only, so the emitted lib needs nothing from the harness
 * at runtime and loads from any profile tree.
 *
 * Browser half (lib/client.js): the dsh.client bundle. It imports nothing
 * (pure DOM + the ctx handed to apply), so the bundle has no externals and
 * rides the shell's __ModuleLoader__.load handoff exactly like the shipped
 * ui-* bundles. 'client.js' is the entryFileNames pin the client-modules
 * node half serves under /plugins/dsh-mobile/client.js.
 */
import { defineConfig } from 'tsdown'

const CLIENT_BANNER = 'window.__ModuleLoader__.load({ id: "dsh-mobile", factory: (require) => {'
const CLIENT_FOOTER = 'return module.exports; } });'
const CLIENT_INTRO = 'var module = { exports: {} }; var exports = module.exports;'

export default defineConfig([
  {
    name: 'dsh-mobile',
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    dts: false,
    clean: false,
    // The one runtime value dep; everything else is type-only or node builtin.
    deps: { neverBundle: ['qrcode'] },
    outputOptions: {
      // package.json main points at lib/index.js (format esm pins the name).
      entryFileNames: 'index.js',
    },
  },
  {
    name: 'dsh-mobile/client',
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    clean: false,
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: CLIENT_BANNER,
      footer: CLIENT_FOOTER,
      intro: CLIENT_INTRO,
    },
  },
])
