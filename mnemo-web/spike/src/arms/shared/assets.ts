/**
 * Real bitmaps for image elements, generated once rather than fetched.
 *
 * The spike needs genuine decoded images so that decode cost, texture upload and image
 * cache behaviour are all exercised; a coloured div would quietly remove a real per-frame
 * cost from the measurement. Generating them keeps the spike self-contained, which matters
 * because it has to run from a bare loopback server inside a desktop webview with no
 * access to the app's asset endpoints.
 */

const SIZE = 512
const PALETTES: readonly [string, string][] = [
  ['#3b6ea5', '#0f1115'],
  ['#a55b3b', '#151013'],
  ['#3ba57e', '#0f1512'],
  ['#8a3ba5', '#120f15'],
]

let cache: readonly string[] | null = null

export function imageDataUrls(): readonly string[] {
  if (cache) return cache

  const urls: string[] = []
  for (const [from, to] of PALETTES) {
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      urls.push('')
      continue
    }
    const gradient = ctx.createLinearGradient(0, 0, SIZE, SIZE)
    gradient.addColorStop(0, from)
    gradient.addColorStop(1, to)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, SIZE, SIZE)

    // Some high-frequency detail, so the encoder cannot collapse this to a trivially
    // small image that decodes far faster than a real photograph would.
    ctx.globalAlpha = 0.25
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#ffffff' : '#000000'
      const x = (i * 37) % SIZE
      const y = (i * 91) % SIZE
      ctx.fillRect(x, y, 11, 11)
    }
    urls.push(canvas.toDataURL('image/png'))
  }

  cache = urls
  return urls
}

export function imageUrlFor(assetId: string): string {
  const urls = imageDataUrls()
  if (urls.length === 0) return ''
  let hash = 0
  for (let i = 0; i < assetId.length; i++) hash = (hash * 31 + assetId.charCodeAt(i)) >>> 0
  return urls[hash % urls.length] ?? ''
}
