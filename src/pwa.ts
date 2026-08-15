/**
 * PWA chrome for the Harness web GUI: index.html taps (iOS standalone meta,
 * viewport-fit, apple-touch-icon link), procedural icon routes, an enhanced
 * manifest.webmanifest override, and the /mobile QR page that turns a phone
 * camera into the fastest path to the LAN URL.
 *
 * Everything registers on the core (loopback) webserver, so it is served on
 * the loopback GUI and — through the LAN proxy — on the phone alike.
 * @module dsh-mobile/pwa
 */

import { iconPng } from './icons.ts'
import type { ServerResponse } from 'node:http'

/** Structural slice of the host context this module needs. */
export interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: unknown, res: ServerResponse) => void | Promise<void>
  }): () => void
  tapIndex(transform: (html: string) => string): () => void
}

/** The LAN URL the phone should open (primary address + proxy port). */
export interface PwaOptions {
  lanUrl: string
  lanAddresses: readonly string[]
  port: number
  /** Function producing the QR SVG for a URL (injected for testability). */
  qrSvg: (text: string) => Promise<string>
}

const APP_NAME = 'DeepSeek Harness'

/** Replace or inject the viewport meta and append the iOS standalone chrome. */
function injectHead(html: string): string {
  let out = html
  const viewport = 'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content'
  if (/<meta[^>]+name=["']viewport["']/i.test(out)) {
    out = out.replace(/<meta[^>]+name=["']viewport["'][^>]*>/i, `<meta name="viewport" content="${viewport}" />`)
  } else {
    out = out.replace('</head>', `<meta name="viewport" content="${viewport}" />
</head>`)
  }
  const tags = [
    '<meta name="apple-mobile-web-app-capable" content="yes" />',
    '<meta name="mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
    `<meta name="apple-mobile-web-app-title" content="${APP_NAME}" />`,
    '<meta name="theme-color" content="#0b1220" />',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
    '<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />',
  ]
  for (const tag of tags) {
    const probe = tag.match(/<meta[^>]+name=["']([^"']+)["']/) ?? tag.match(/<link[^>]+rel=["']([^"']+)["']/)
    const key = probe?.[1]
    if (key !== undefined && new RegExp(`<(meta|link)[^>]+\\.${key}\\.`).test(out)) continue
    if (out.includes(tag)) continue
    out = out.replace('</head>', `${tag}
</head>`)
  }
  return out
}

const MANIFEST = {
  id: '/',
  name: APP_NAME,
  short_name: 'DSH',
  description: 'DeepSeek Harness — AI agent harness, usable from iPhone and iPad.',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#0b1220',
  theme_color: '#4f7cf7',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  ],
}

function jsonResponse(res: ServerResponse, body: unknown, type = 'application/json; charset=utf-8'): void {
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

/** Build the /mobile landing page (QR + steps + warning). */
function mobilePage(opts: PwaOptions, qrSvg: string): string {
  const { lanUrl, lanAddresses, port } = opts
  const alternatives = lanAddresses
    .filter(addr => !lanUrl.includes(addr))
    .map(addr => `http://${addr}:${port}`)
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>在手机 / iPad 上使用 DeepSeek Harness</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, 'PingFang SC', 'Segoe UI', sans-serif; background: #0b1220; color: #e5e9f2; display: flex; justify-content: center; padding: 32px 20px 64px; }
  .card { width: min(520px, 100%); }
  h1 { font-size: 22px; margin: 0 0 6px; }
  .sub { color: #94a3b8; font-size: 14px; margin-bottom: 24px; }
  .url { font-size: 17px; font-weight: 600; color: #7c9dff; word-break: break-all; user-select: all; padding: 12px 14px; background: rgba(79,124,247,0.12); border: 1px solid rgba(79,124,247,0.35); border-radius: 12px; margin-bottom: 20px; }
  .qr { background: #fff; border-radius: 16px; padding: 18px; display: flex; justify-content: center; margin-bottom: 20px; }
  .qr svg { width: min(280px, 80vw); height: auto; }
  .steps { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 16px 18px; margin-bottom: 20px; }
  .steps ol { margin: 0; padding-left: 20px; }
  .steps li { margin: 8px 0; font-size: 14px; line-height: 1.6; }
  .warn { background: rgba(255,170,60,0.08); border: 1px solid rgba(255,170,60,0.35); color: #ffd9a3; border-radius: 12px; padding: 14px 16px; font-size: 13px; line-height: 1.7; margin-bottom: 20px; }
  .alts { font-size: 12px; color: #64748b; }
  .alts a { color: #64748b; }
</style>
</head>
<body>
  <div class="card">
    <h1>在 iPhone / iPad 上使用</h1>
    <div class="sub">DeepSeek Harness 局域网访问 · 同一 Wi-Fi 下用相机扫码即开</div>
    <div class="url">${lanUrl}</div>
    <div class="qr">${qrSvg}</div>
    <div class="steps">
      <ol>
        <li>用 iPhone / iPad 的<b>相机</b>扫描上面的二维码(或直接输入网址);</li>
        <li>打开后点 Safari 底部的<b>「分享」</b>按钮 → <b>「添加到主屏幕」</b>;</li>
        <li>之后就能像原生 App 一样从主屏幕图标打开。</li>
      </ol>
    </div>
    <div class="warn"><b>⚠ 安全提示:</b> 这个地址把 Harness 的完整能力(包括执行代码的工具)暴露给了<b>同一局域网内的所有设备</b>。请只在信任的网络(自家 Wi-Fi)使用,连接公共 Wi-Fi 时请关闭本插件(从 cordis.patch.yml 移除 mobile 行)。</div>
    ${alternatives.length > 0 ? `<div class="alts">其他地址: ${alternatives.map(a => `<a href="${a}">${a}</a>`).join(' · ')}</div>` : ''}
  </div>
</body>
</html>`
}

/**
 * Install the PWA taps, icon/manifest routes, and the /mobile page.
 * @param ctx - host context with the webserver.
 * @param options - LAN URL facts and the QR renderer.
 * @returns disposers (registered through the caller's effect).
 */
export function installPwa(ctx: { webServer: WebServerLike }, options: PwaOptions): () => void {
  const disposers: Array<() => void> = []
  disposers.push(ctx.webServer.tapIndex(injectHead))

  const sendIcon = (size: number) => (res: ServerResponse): void => {
    const buf = iconPng(size)
    res.writeHead(200, {
      'content-type': 'image/png',
      'content-length': String(buf.length),
      'cache-control': 'public, max-age=86400',
    })
    res.end(buf)
  }
  disposers.push(ctx.webServer.register({ kind: 'exact', path: '/apple-touch-icon.png', handler: (_req, res) => sendIcon(180)(res) }))
  disposers.push(ctx.webServer.register({ kind: 'exact', path: '/icons/icon-192.png', handler: (_req, res) => sendIcon(192)(res) }))
  disposers.push(ctx.webServer.register({ kind: 'exact', path: '/icons/icon-512.png', handler: (_req, res) => sendIcon(512)(res) }))
  disposers.push(ctx.webServer.register({ kind: 'exact', path: '/manifest.webmanifest', handler: (_req, res) => jsonResponse(res, MANIFEST, 'application/manifest+json; charset=utf-8') }))

  // The /mobile page is async (QR render); guard against unhandled rejections.
  let pageCache: string | undefined
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/mobile',
    handler: async (_req, res) => {
      if (pageCache === undefined) {
        const qrSvg = await options.qrSvg(options.lanUrl)
        pageCache = mobilePage(options, qrSvg)
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' })
      res.end(pageCache)
    },
  }))

  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
