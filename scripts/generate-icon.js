#!/usr/bin/env node
/**
 * generate-icon.js
 * Generates build/icon.ico (Windows) and build/icon.icns (macOS) for
 * electron-builder from the Wharf Archive logo.
 * Uses only Node.js built-ins — no extra dependencies required.
 *
 * Logo: isometric "layers" box, #0078ff on #1a1a2e, matching the UI logo SVG.
 * Run: node scripts/generate-icon.js
 */

const zlib = require('zlib')
const fs   = require('fs')
const path = require('path')

// ── CRC32 ──────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    t[i] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// ── PNG builder ────────────────────────────────────────────────────────────

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii')
  const d = Buffer.isBuffer(data) ? data : Buffer.from(data)
  const len = Buffer.alloc(4); len.writeUInt32BE(d.length)
  const crcVal = Buffer.alloc(4); crcVal.writeUInt32BE(crc32(Buffer.concat([t, d])))
  return Buffer.concat([len, t, d, crcVal])
}

function makePng(w, h, rgba) {
  // rgba: Uint8Array, 4 bytes per pixel (R G B A), row-major, top-to-bottom
  const sig  = Buffer.from('89504e470d0a1a0a', 'hex')

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8]  = 8  // bit depth
  ihdr[9]  = 6  // color type: RGBA
  ihdr[10] = 0  // compression (deflate)
  ihdr[11] = 0  // filter method
  ihdr[12] = 0  // interlace: none

  // Build raw scanlines (1 filter byte + RGBA per row)
  const raw = Buffer.alloc(h * (1 + w * 4))
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0 // filter: None
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4
      const di = y * (1 + w * 4) + 1 + x * 4
      raw[di]     = rgba[si]
      raw[di + 1] = rgba[si + 1]
      raw[di + 2] = rgba[si + 2]
      raw[di + 3] = rgba[si + 3]
    }
  }

  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

// ── Pixel renderer ─────────────────────────────────────────────────────────

function renderIcon(size) {
  const px = new Uint8Array(size * size * 4)

  // Background: #1a1a2e
  for (let i = 0; i < size * size; i++) {
    px[i * 4]     = 0x1a
    px[i * 4 + 1] = 0x1a
    px[i * 4 + 2] = 0x2e
    px[i * 4 + 3] = 0xff
  }

  // Alpha-composite a color over the existing pixel
  const blend = (x, y, r, g, b, a) => {
    x = Math.round(x); y = Math.round(y)
    if (x < 0 || x >= size || y < 0 || y >= size) return
    const i = (y * size + x) * 4
    const sa = a / 255
    px[i]     = Math.round(px[i]     * (1 - sa) + r * sa)
    px[i + 1] = Math.round(px[i + 1] * (1 - sa) + g * sa)
    px[i + 2] = Math.round(px[i + 2] * (1 - sa) + b * sa)
    px[i + 3] = 0xff
  }

  // Draw a thick anti-aliased line segment
  const drawLine = (x0, y0, x1, y1, r, g, b, alpha, thick) => {
    const dx = x1 - x0, dy = y1 - y0
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len < 0.001) return
    const steps = Math.ceil(len * 4)
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const cx = x0 + dx * t
      const cy = y0 + dy * t
      const hw = Math.ceil(thick) + 1
      for (let oy = -hw; oy <= hw; oy++) {
        for (let ox = -hw; ox <= hw; ox++) {
          const d = Math.sqrt(ox * ox + oy * oy)
          if (d <= thick) {
            blend(cx + ox, cy + oy, r, g, b, alpha)
          } else if (d <= thick + 1) {
            const edge = (thick + 1 - d)
            blend(cx + ox, cy + oy, r, g, b, Math.round(alpha * edge))
          }
        }
      }
    }
  }

  // The logo SVG has a 24×24 viewBox.
  // We scale it to fit inside the icon with a small margin.
  const margin = size * 0.10
  const scale  = (size - margin * 2) / 24
  const sx = x => x * scale + margin
  const sy = y => y * scale + margin

  // Line thickness scales with icon size (≈1.3 px at 24-unit scale)
  const thick = Math.max(0.6, size / 24 * 1.25)

  // Blue #0078ff
  const [BR, BG, BB] = [0x00, 0x78, 0xff]
  // Lighter blue for the middle layer (#60a8ff, semi-transparent in SVG)
  const [LR, LG, LB] = [0x60, 0xa8, 0xff]
  const midAlpha = Math.round(255 * 0.65)

  // ── Top diamond face: M12 2 L2 7 l10 5 10-5 -10-5 z ──
  //   Vertices: (12,2) → (2,7) → (12,12) → (22,7) → back to (12,2)
  drawLine(sx(12), sy(2),  sx(2),  sy(7),  BR, BG, BB, 255, thick)
  drawLine(sx(2),  sy(7),  sx(12), sy(12), BR, BG, BB, 255, thick)
  drawLine(sx(12), sy(12), sx(22), sy(7),  BR, BG, BB, 255, thick)
  drawLine(sx(22), sy(7),  sx(12), sy(2),  BR, BG, BB, 255, thick)

  // ── Left + right vertical edges (implied by the 3-layer shape) ──
  drawLine(sx(2),  sy(7),  sx(2),  sy(17), BR, BG, BB, 255, thick)
  drawLine(sx(22), sy(7),  sx(22), sy(17), BR, BG, BB, 255, thick)

  // ── Middle layer edge (opacity 0.45): M2 12 l10 5 10-5 ──
  //   (2,12) → (12,17) → (22,12)
  drawLine(sx(2),  sy(12), sx(12), sy(17), LR, LG, LB, midAlpha, thick)
  drawLine(sx(12), sy(17), sx(22), sy(12), LR, LG, LB, midAlpha, thick)

  // ── Bottom edge: M2 17 l10 5 10-5 ──
  //   (2,17) → (12,22) → (22,17)
  drawLine(sx(2),  sy(17), sx(12), sy(22), BR, BG, BB, 255, thick)
  drawLine(sx(12), sy(22), sx(22), sy(17), BR, BG, BB, 255, thick)

  return makePng(size, size, px)
}

// ── ICO builder ────────────────────────────────────────────────────────────

function makeIco(sizes) {
  const pngs   = sizes.map(s => renderIcon(s))
  const count  = pngs.length
  const HEADER = 6
  const DIR    = 16 * count
  let   offset = HEADER + DIR

  // 6-byte ICONDIR header
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)     // reserved
  header.writeUInt16LE(1, 2)     // type: 1 = ICO
  header.writeUInt16LE(count, 4)

  const dirs = pngs.map((png, i) => {
    const s   = sizes[i]
    const dir = Buffer.alloc(16)
    dir[0] = s >= 256 ? 0 : s   // width  (0 means 256)
    dir[1] = s >= 256 ? 0 : s   // height (0 means 256)
    dir[2] = 0                   // palette colors (0 = no palette)
    dir[3] = 0                   // reserved
    dir.writeUInt16LE(1,  4)     // planes
    dir.writeUInt16LE(32, 6)     // bits per pixel
    dir.writeUInt32LE(png.length, 8)  // image data size
    dir.writeUInt32LE(offset,    12)  // offset from start of file
    offset += png.length
    return dir
  })

  return Buffer.concat([header, ...dirs, ...pngs])
}

// ── ICNS builder ───────────────────────────────────────────────────────────
// Modern ICNS chunks may contain raw PNG data, so we can reuse renderIcon().
// Type codes map to fixed pixel sizes (retina variants share the pixel size
// of the next size up, so plain types are enough for electron-builder).

const ICNS_TYPES = [
  ['icp4', 16],
  ['icp5', 32],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024]
]

function makeIcns() {
  const chunks = ICNS_TYPES.map(([type, size]) => {
    const png  = renderIcon(size)
    const head = Buffer.alloc(8)
    head.write(type, 0, 'ascii')
    head.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([head, png])
  })
  const body   = Buffer.concat(chunks)
  const header = Buffer.alloc(8)
  header.write('icns', 0, 'ascii')
  header.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([header, body])
}

// ── Entry point ────────────────────────────────────────────────────────────

const outDir  = path.join(__dirname, '..', 'build')
fs.mkdirSync(outDir, { recursive: true })

const icoPath = path.join(outDir, 'icon.ico')
const ico     = makeIco([16, 32, 48, 256])
fs.writeFileSync(icoPath, ico)
console.log(`✓  Wrote ${icoPath}  (${(ico.length / 1024).toFixed(1)} KB, sizes: 16 32 48 256)`)

const icnsPath = path.join(outDir, 'icon.icns')
const icns     = makeIcns()
fs.writeFileSync(icnsPath, icns)
console.log(`✓  Wrote ${icnsPath}  (${(icns.length / 1024).toFixed(1)} KB, sizes: ${ICNS_TYPES.map(t => t[1]).join(' ')})`)
