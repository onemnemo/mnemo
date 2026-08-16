/**
 * The picture, as pixels.
 *
 * Through an `<img>` and a canvas rather than through a second renderer, so a PNG is by construction
 * the SVG that was just emitted rather than another drawing of the same map that could disagree with
 * it. The blob URL is same origin, which is what keeps the canvas readable.
 */

import type { SvgPicture } from "./svg"

/**
 * How far the longest side may run.
 *
 * The same ceiling the desktop uses. It is not arithmetic: past a few thousand pixels a side, canvas
 * allocation starts failing outright on some machines, and a big map at two times scale reaches that
 * quickly.
 */
export const MAX_DIMENSION = 8000

export async function rasterize(picture: SvgPicture, scale = 2): Promise<Blob> {
  const capped = Math.min(scale, MAX_DIMENSION / Math.max(picture.width, picture.height))
  const width = Math.max(1, Math.round(picture.width * capped))
  const height = Math.max(1, Math.round(picture.height * capped))

  const url = URL.createObjectURL(new Blob([picture.markup], { type: "image/svg+xml;charset=utf-8" }))
  try {
    const image = await load(url)
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext("2d")
    if (!context) {
      throw new Error("This browser has no 2D canvas to draw the map onto.")
    }
    context.drawImage(image, 0, 0, width, height)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("The map could not be turned into a PNG."))),
        "image/png",
      )
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("The map could not be drawn."))
    image.src = url
  })
}
