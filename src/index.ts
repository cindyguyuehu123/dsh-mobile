/**
 * dsh-mobile host entry: makes the DeepSeek Harness web GUI usable from
 * iPhone / iPad.
 *
 *  - LAN proxy: an explicit-opt-in reverse proxy on 0.0.0.0:<port> that
 *    forwards HTTP + WebSocket to the loopback webserver, rewriting
 *    Host/Origin so the /api trust fence accepts phone traffic.
 *  - PWA chrome: iOS standalone meta + apple-touch-icon via index taps,
 *    procedural PNG icons, an enhanced manifest, and a /mobile QR page.
 *
 * Security: enabling this plugin exposes the full Harness (code execution
 * included) to every device on the LAN. The console warning and the /mobile
 * page say so; keep it enabled only on trusted networks.
 * @module dsh-mobile
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import QRCode from 'qrcode'
import { LanProxy, lanAddresses } from './lan-proxy.ts'
import { installPwa, type WebServerLike } from './pwa.ts'

/** Stable plugin name for the loader. */
export const name = 'dsh-mobile'

/** Services this row needs before apply runs. */
export const inject = ['webServer']

/** Structural host context (cordis types stay out of the emitted bundle). */
export interface MobileHostContext {
  webServer: WebServerLike & {
    host: string
    port: number
  }
  effect(callback: () => (() => void) | void, label?: string): unknown
  logger: {
    info(...args: unknown[]): void
    warn(...args: unknown[]): void
  }
}

/** Plugin config (row config; defaults applied manually). */
export interface MobileConfig {
  /** Port for the LAN proxy; tries consecutive ports when busy. */
  lanPort?: number
  /** Optional exact client-IP allowlist (e.g. ['192.168.1.20']); empty = allow all. */
  allow?: string[]
}

/** Default LAN proxy port. */
export const DEFAULT_LAN_PORT = 3090

const WARNING = [
  '────────────────────────────────────────────────────────────',
  '⚠ dsh-mobile: 手机访问已开启,但注意——',
  '  该地址向局域网暴露了 Harness 的完整能力(包括执行代码的工具)。',
  '  只在你信任的网络(自家 Wi-Fi)使用;连接公共 Wi-Fi 时请移除',
  '  cordis.patch.yml 里的 mobile 行或重启前停用本插件。',
  '────────────────────────────────────────────────────────────',
].join('\n')

/**
 * Start the mobile surface: LAN proxy + PWA chrome + URL line.
 * @param ctx - host context (webServer injected).
 * @param config - optional row config.
 */
export async function apply(ctx: MobileHostContext, config?: MobileConfig): Promise<void> {
  const loopbackPort = ctx.webServer.port
  const lanPort = config?.lanPort ?? DEFAULT_LAN_PORT
  const allow = config?.allow ?? []

  // The proxy owns its listen; a bind failure fails this fiber loudly.
  const proxy = await LanProxy.start(loopbackPort, lanPort, allow)
  ctx.effect(() => () => proxy.dispose(), 'dsh-mobile: lan proxy')

  const addresses = lanAddresses()
  if (addresses.length === 0) {
    ctx.logger.warn('dsh-mobile: no non-internal IPv4 interface found — phone access will not work over Wi-Fi.')
  }
  const primary = addresses[0]
  const lanUrl = primary === undefined ? `http://127.0.0.1:${proxy.port}` : `http://${primary}:${proxy.port}`

  const qrSvg = (text: string): Promise<string> => QRCode.toString(text, {
    type: 'svg', margin: 1, errorCorrectionLevel: 'M',
    color: { dark: '#0b1220', light: '#ffffff' },
  })
  ctx.effect(() => installPwa(ctx, {
    lanUrl, lanAddresses: addresses, port: proxy.port, qrSvg,
  }), 'dsh-mobile: pwa chrome')

  ctx.logger.info(`dsh-mobile: 📱 手机 / iPad 访问: ${lanUrl}`)
  if (primary !== undefined) {
    try {
      const terminal = await QRCode.toString(lanUrl, { type: 'terminal', small: true })
      ctx.logger.info('dsh-mobile: 终端二维码(手机相机扫):\n' + terminal)
    } catch {
      // Terminal QR is a nicety; never fail the plugin over it.
    }
  }
  ctx.logger.info('dsh-mobile: 桌面浏览器打开 http://127.0.0.1:' + String(loopbackPort) + '/mobile 可显示大二维码')
  ctx.logger.warn(WARNING)
}

// Re-export the pieces for tests / manual use.
export { LanProxy, lanAddresses } from './lan-proxy.ts'
export { installPwa } from './pwa.ts'
export { iconPng } from './icons.ts'
