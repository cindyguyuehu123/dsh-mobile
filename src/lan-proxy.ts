/**
 * LAN reverse proxy for the Harness web GUI.
 *
 * The core webserver binds loopback only (upstream deliberately rejects
 * `--host 0.0.0.0`). This proxy is an explicit, plugin-owned opt-in: it
 * listens on all interfaces and forwards every request — HTTP and WebSocket
 * upgrades — to the loopback server, rewriting the Host and (same-origin)
 * Origin headers back to loopback so the /api browser-trust fence
 * (isTrustedApiRequest) accepts the proxied traffic exactly as if it had
 * arrived locally.
 *
 * SECURITY: whoever can reach the advertised LAN URL can drive the whole
 * Harness, including its code-execution tools. That is the point of the
 * plugin and the reason it must stay disabled on untrusted networks.
 * @module dsh-mobile/lan-proxy
 */

import { createServer } from 'node:http'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import { request as httpRequest } from 'node:http'
import { networkInterfaces } from 'node:os'
import type { Duplex } from 'node:stream'

/** All non-internal IPv4 addresses of this machine, in os order. */
export function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i): i is NonNullable<typeof i> => i !== undefined && i.family === 'IPv4' && !i.internal)
    .map(i => i.address)
}

/** One live reverse proxy; create via {@link LanProxy.start}. */
export class LanProxy {
  /** @param loopbackPort - the core server's port (ctx.webServer.port). */
  private constructor(
    private readonly loopbackPort: number,
    private readonly server: ReturnType<typeof createServer>,
  ) {}

  /**
   * Bind the proxy on all interfaces and start forwarding.
   * @param loopbackPort - core webserver port.
   * @param listenPort - first port to try on 0.0.0.0.
   * @param allowed - optional exact client IP allowlist ('' = allow all).
   * @returns the started proxy, or throws when every port attempt failed.
   */
  static async start(loopbackPort: number, listenPort: number, allowed: readonly string[] = []): Promise<LanProxy> {
    let lastError: unknown
    for (let port = listenPort; port < listenPort + 10; port++) {
      try {
        return await LanProxy.bind(loopbackPort, port, allowed)
      } catch (error) {
        lastError = error
        // EADDRINUSE walks to the next port; anything else is fatal.
        if (!(error instanceof Error && 'code' in error && error.code === 'EADDRINUSE')) throw error
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  private static bind(loopbackPort: number, port: number, allowed: readonly string[]): Promise<LanProxy> {
    return new Promise((resolve, reject) => {
      const blocked = (ip: string): boolean => allowed.length > 0 && !allowed.includes(ip)
      const server = createServer((req, res) => {
        if (blocked(clientIp(req))) {
          res.writeHead(403)
          res.end('forbidden')
          return
        }
        void forwardRequest(req, res, loopbackPort).catch(() => {
          if (!res.headersSent) res.writeHead(502)
          res.end('proxy error')
        })
      })
      server.on('upgrade', (req, socket, head) => {
        if (blocked(clientIp(req))) {
          socket.destroy()
          return
        }
        forwardUpgrade(req, socket, head, loopbackPort)
      })
      server.once('error', reject)
      server.listen(port, '0.0.0.0', () => {
        server.off('error', reject)
        server.on('error', err => { /* logged by caller through dispose */ void err })
        resolve(new LanProxy(loopbackPort, server))
      })
    })
  }

  /** The bound port (0.0.0.0). */
  get port(): number {
    const addr = this.server.address()
    return typeof addr === 'object' && addr !== null ? addr.port : 0
  }

  /** Close the listener, drop remaining connections, and wait for teardown. */
  async dispose(): Promise<void> {
    const server = this.server
    // Drop idle keep-alive sockets first, or close() would wait on them forever.
    server.closeAllConnections?.()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}

/** The socket's remote address for allowlist checks. */
function clientIp(req: IncomingMessage): string {
  const sock = req.socket
  const addr = sock.remoteAddress ?? ''
  // Strip the IPv6-mapped prefix node uses for IPv4 clients on ::.
  return addr.startsWith('::ffff:') ? addr.slice(7) : addr
}

/** Headers for the upstream request: loopback Host, loopback Origin for same-origin browsers. */
function forwardedHeaders(headers: IncomingHttpHeaders, proxyAuthority: string, loopbackPort: number): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue
    const lower = key.toLowerCase()
    // Host/Origin are rewritten below; connection/upgrade are owned by the
    // caller (node manages them for plain requests, the upgrade path sets
    // them explicitly).
    if (lower === 'host' || lower === 'origin' || lower === 'connection' || lower === 'upgrade') continue
    out[key] = value
  }
  out.host = `127.0.0.1:${loopbackPort}`
  const origin = headers.origin
  if (typeof origin === 'string') {
    try {
      if (new URL(origin).host === proxyAuthority) {
        out.origin = `http://127.0.0.1:${loopbackPort}`
      }
    } catch {
      // Malformed origin: leave it unset; the trust fence rejects anyway.
    }
  }
  return out
}

/** Proxy one plain HTTP request to the loopback server. */
async function forwardRequest(req: IncomingMessage, res: ServerResponse, loopbackPort: number): Promise<void> {
  const proxyAuthority = req.headers.host ?? ''
  const upstream = httpRequest({
    host: '127.0.0.1',
    port: loopbackPort,
    path: req.url,
    method: req.method,
    headers: forwardedHeaders(req.headers, proxyAuthority, loopbackPort),
  }, (upRes) => {
    res.writeHead(upRes.statusCode ?? 502, upRes.headers)
    upRes.pipe(res)
  })
  upstream.on('error', (error) => {
    if (!res.headersSent) res.writeHead(502)
    res.end('proxy error')
    void error
  })
  res.on('close', () => upstream.destroy())
  req.pipe(upstream)
}

/** Proxy a WebSocket upgrade to the loopback server, keeping one raw duplex. */
function forwardUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  loopbackPort: number,
): void {
  const proxyAuthority = req.headers.host ?? ''
  const upstream = httpRequest({
    host: '127.0.0.1',
    port: loopbackPort,
    path: req.url,
    method: 'GET',
    headers: {
      ...forwardedHeaders(req.headers, proxyAuthority, loopbackPort),
      connection: 'Upgrade',
      upgrade: 'websocket',
    },
    agent: false,
  })
  upstream.on('upgrade', (upRes, upSocket, upHead) => {
    // Relay the 101 with the upstream's negotiated headers, then splice the
    // two raw sockets into one duplex.
    socket.write('HTTP/1.1 101 Switching Protocols\r\n')
    for (const [key, value] of Object.entries(upRes.headers)) {
      if (value === undefined) continue
      socket.write(`${key}: ${Array.isArray(value) ? value.join(', ') : value}\r\n`)
    }
    socket.write('\r\n')
    if (upHead.length > 0) socket.write(upHead)
    upSocket.pipe(socket)
    socket.pipe(upSocket)
    const close = (): void => { upSocket.destroy(); socket.destroy() }
    upSocket.on('error', close)
    socket.on('error', close)
  })
  upstream.on('response', (upRes) => {
    // Non-101 upstream response (e.g. 403 from the trust fence): relay it.
    socket.end([
      `HTTP/1.1 ${upRes.statusCode ?? 502}`,
      ...Object.entries(upRes.headers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`),
      '',
      '',
    ].join('\r\n'))
    upRes.destroy()
  })
  upstream.on('error', () => socket.destroy())
  if (head.length > 0) upstream.write(head)
  upstream.end()
}
