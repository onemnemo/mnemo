import { BAND_EXTENT, bandStops, brandMark, ICON_PATHS, type LogoId } from "./marks"

/**
 * The OS icon for a logo: the petals on a white rounded tile, drawn straight onto a
 * canvas with Path2D rather than through an SVG image, which WebKit can refuse to
 * paint onto a canvas it then lets us read back.
 */

/** Which file the host wants: Windows takes an ICO, Linux and macOS a single PNG. */
export type IconFormat = "ico" | "png256" | "png1024"

/** Bumped when the drawing changes, so a host holding the old render is sent a new one. */
const RENDER_VERSION = 1

/** Identifies one render. The accent only matters to the accent logo. */
export function iconKey(logo: LogoId, accent: string): string {
  return logo === "accent" ? `v${RENDER_VERSION}:accent:${accent}` : `v${RENDER_VERSION}:${logo}`
}

const ICO_SIZES = [16, 24, 32, 48, 64, 256]

/** The tile and mark, in a 256 box for Windows and Linux or on Apple's 1024 grid. */
const GEOMETRY = {
  tile: { box: 256, inset: 8, radius: 56, markWidth: 180 },
  mac: { box: 1024, inset: 100, radius: 185, markWidth: 618 },
} as const

const TILE = "#ffffff"

export async function renderIconFile(format: IconFormat, logo: LogoId, accentFill: string): Promise<Uint8Array> {
  if (format === "png1024") return renderPng(1024, "mac", logo, accentFill)
  if (format === "png256") return renderPng(256, "tile", logo, accentFill)
  const pngs = await Promise.all(ICO_SIZES.map((size) => renderPng(size, "tile", logo, accentFill)))
  return encodeIco(ICO_SIZES.map((size, i) => ({ size, png: pngs[i] })))
}

async function renderPng(size: number, shape: keyof typeof GEOMETRY, logo: LogoId, accentFill: string) {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = size
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("No 2D canvas")

  const g = GEOMETRY[shape]
  ctx.scale(size / g.box, size / g.box)
  ctx.fillStyle = TILE
  ctx.beginPath()
  ctx.roundRect(g.inset, g.inset, g.box - g.inset * 2, g.box - g.inset * 2, g.radius)
  ctx.fill()

  const scale = g.markWidth / 60
  ctx.translate((g.box - g.markWidth) / 2, (g.box - 50 * scale) / 2)
  ctx.scale(scale, scale)
  ctx.fillStyle = markFill(ctx, logo, accentFill)
  // A colour the canvas cannot parse is ignored, which would paint the mark white on the tile.
  if (ctx.fillStyle === TILE) throw new Error(`Unpaintable accent: ${accentFill}`)
  for (const d of ICON_PATHS) ctx.fill(new Path2D(d))

  return toPng(canvas)
}

function markFill(ctx: CanvasRenderingContext2D, logo: LogoId, accentFill: string) {
  const mark = brandMark(logo)
  if (!mark) return accentFill
  const gradient = ctx.createLinearGradient(0, 0, BAND_EXTENT, BAND_EXTENT)
  for (const { offset, color } of bandStops(mark.colors)) gradient.addColorStop(offset, color)
  return gradient
}

function toPng(canvas: HTMLCanvasElement) {
  return new Promise<Uint8Array>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error("Icon render failed"))
      blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject)
    }, "image/png")
  })
}

/** An ICO whose entries are PNGs, which Windows has read since Vista. */
export function encodeIco(entries: { size: number; png: Uint8Array }[]): Uint8Array {
  const headerSize = 6 + entries.length * 16
  const total = headerSize + entries.reduce((sum, entry) => sum + entry.png.length, 0)
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint16(0, 0, true)
  view.setUint16(2, 1, true)
  view.setUint16(4, entries.length, true)

  let offset = headerSize
  entries.forEach(({ size, png }, i) => {
    const at = 6 + i * 16
    // A dimension byte of 0 means 256.
    view.setUint8(at, size >= 256 ? 0 : size)
    view.setUint8(at + 1, size >= 256 ? 0 : size)
    view.setUint16(at + 4, 1, true)
    view.setUint16(at + 6, 32, true)
    view.setUint32(at + 8, png.length, true)
    view.setUint32(at + 12, offset, true)
    out.set(png, offset)
    offset += png.length
  })
  return out
}

/**
 * The accent as a canvas can paint it, always the light-theme value so the OS icon
 * does not change colour with the theme.
 */
export function lightAccentFill(accent: string): string {
  const probe = document.createElement("span")
  probe.dataset.theme = "light"
  probe.dataset.accent = accent
  probe.style.display = "none"
  document.body.append(probe)
  const value = getComputedStyle(probe).getPropertyValue("--accent").trim()
  probe.remove()
  return value
}
