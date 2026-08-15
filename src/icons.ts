/**
 * Procedural app icons: a tiny PNG encoder (zlib + CRC32) plus a
 * dependency-free vector renderer (signed-distance-field shapes with smooth
 * alpha edges, drawn in normalized 0..1 space so any size renders crisply).
 * The design is a chat bubble with three dots on the dsh brand blue — small
 * enough to read at 180px (iOS home screen) and 512px (manifest).
 * @module dsh-mobile/icons
 */

import { deflateSync } from 'node:zlib'

/* ── minimal PNG encoder ─────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/** Encode an RGBA pixel buffer (width*height*4) as a PNG. */
function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8  // bit depth
  ihdr[9] = 6  // color type RGBA
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/* ── SDF drawing helpers (normalized coordinates) ────────────────────── */

/** Signed distance to a rounded rectangle centered at origin, half-extents (hx,hy), corner radius r. */
function sdRoundRect(px: number, py: number, hx: number, hy: number, r: number): number {
  const qx = Math.abs(px) - (hx - r)
  const qy = Math.abs(py) - (hy - r)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r
}

/** Signed distance to a circle. */
function sdCircle(px: number, py: number, cx: number, cy: number, r: number): number {
  return Math.hypot(px - cx, py - cy) - r
}

/** Signed distance to a diamond (|dx|+|dy| < s). */
function sdDiamond(px: number, py: number, cx: number, cy: number, s: number): number {
  return Math.abs(px - cx) + Math.abs(py - cy) - s
}

/** Smooth 0..1 coverage from an SDF, with a ~1px antialiased edge. */
function coverage(sdf: number, px: number): number {
  return Math.min(1, Math.max(0, 0.5 - sdf / px))
}

/** Linear interpolation between two hex colors. */
function mix(a: string, b: string, t: number): [number, number, number] {
  const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16))
  return [0, 1, 2].map(i => Math.round(pa[i] + (pb[i] - pa[i]) * t)) as [number, number, number]
}

/**
 * Render the app icon at one size.
 * @param size - square side in pixels.
 * @returns a PNG buffer.
 */
export function renderIcon(size: number): Buffer {
  const px = Buffer.alloc(size * size * 4)
  const bgTop: [number, number, number] = mix('#4f7cf7', '#2c4bb5', 0)
  const bgBottom: [number, number, number] = mix('#4f7cf7', '#2c4bb5', 1)
  const blue: [number, number, number] = [47, 75, 181]
  const white: [number, number, number] = [255, 255, 255]

  const edge = 1 / size
  const radius = 0.22
  const bubble = { cx: 0.5, cy: 0.46, r: 0.30 }
  const dotR = 0.038

  // Associated-alpha "over" operator: composite (cr,cg,cb) with coverage cov
  // over the current pixel color (r,g,b,a). Exact at cov=0/1, smooth in between.
  const over = (
    r: number, g: number, b: number, a: number,
    cr: number, cg: number, cb: number, cov: number,
  ): [number, number, number, number] => {
    const outA = a + cov * (1 - a)
    const t = outA < 1e-9 ? 0 : cov / outA
    return [r + (cr - r) * t, g + (cg - g) * t, b + (cb - b) * t, outA]
  }

  for (let y = 0; y < size; y++) {
    const ny = (y + 0.5) / size // normalized, origin at center (0.5, 0.5)
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size
      const px2 = nx - 0.5
      const py2 = ny - 0.5

      let r = 0, g = 0, b = 0, a = 0

      // Background: rounded rect, vertical gradient.
      const bgCov = coverage(sdRoundRect(px2, py2, 0.5, 0.5, radius), edge)
      if (bgCov > 0) {
        const t = Math.min(1, Math.max(0, ny))
        const br = Math.round(bgTop[0] + (bgBottom[0] - bgTop[0]) * t)
        const bg = Math.round(bgTop[1] + (bgBottom[1] - bgTop[1]) * t)
        const bb = Math.round(bgTop[2] + (bgBottom[2] - bgTop[2]) * t)
        ;[r, g, b, a] = over(r, g, b, a, br, bg, bb, bgCov)
      }

      // White bubble (circle + diamond tail).
      const bubbleSdf = Math.min(
        sdCircle(nx, ny, bubble.cx, bubble.cy, bubble.r),
        sdDiamond(nx, ny, 0.31, 0.74, 0.10),
      )
      const bubbleCov = coverage(bubbleSdf, edge)
      if (bubbleCov > 0) {
        ;[r, g, b, a] = over(r, g, b, a, white[0], white[1], white[2], bubbleCov)
      }

      // Three brand-blue dots inside the bubble.
      for (const dx of [-0.115, 0, 0.115]) {
        const dotCov = coverage(sdCircle(nx, ny, bubble.cx + dx, bubble.cy, dotR), edge)
        if (dotCov > 0) {
          ;[r, g, b, a] = over(r, g, b, a, blue[0], blue[1], blue[2], dotCov)
        }
      }

      const idx = (y * size + x) * 4
      px[idx] = Math.round(r)
      px[idx + 1] = Math.round(g)
      px[idx + 2] = Math.round(b)
      px[idx + 3] = Math.round(a * 255)
    }
  }
  return encodePng(size, size, px)
}

/** Cached icon buffers (generated once per size at first use). */
const cache = new Map<number, Buffer>()

/** Get (and cache) the icon PNG at one size. */
export function iconPng(size: number): Buffer {
  let buf = cache.get(size)
  if (buf === undefined) {
    buf = renderIcon(size)
    cache.set(size, buf)
  }
  return buf
}