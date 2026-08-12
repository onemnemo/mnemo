/**
 * The pictures a map can carry on its canvas.
 *
 * An image element stores nothing but a file name, which is what the desktop stores, so a map made
 * in either app resolves in the other. Everything that name has to go through to become a picture
 * lives here: the upload, the route it is served from, the box a freshly placed one gets, and the
 * hook that turns it into something an `<img>` will accept.
 */

import { useEffect, useState } from "react"

import { apiFetch } from "@/api/client"
import { fetchAssetBlob, fetchAssetBlobUrl } from "@/api/asset-blob"

/** Mirrors Mnemo.Host/Contracts/MindmapDto.cs. */
export interface MindmapAsset {
  assetId: string
  sizeBytes: number
}

/** What the store accepts, which is what a browser can draw. Anything else is not an image here. */
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"])

/**
 * What the file picker offers, which is the same list.
 *
 * Extensions rather than `image/*`, which would offer files the store then refuses: an SVG or a TIFF
 * is an image to the browser and not one here. Better the picker never shows it than the upload
 * comes back with an explanation.
 */
export const IMAGE_ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.bmp"

/** The image files in a drop or a paste, in the order they were carried. */
export function imageFilesOf(data: DataTransfer | null): File[] {
  if (!data) {
    return []
  }
  return Array.from(data.files).filter((file) => IMAGE_TYPES.has(file.type))
}

export function uploadMindmapImage(file: File): Promise<MindmapAsset> {
  const form = new FormData()
  form.append("file", file)
  // No Content-Type header: the browser has to set the multipart boundary itself.
  return apiFetch<MindmapAsset>("/mindmaps/assets", { method: "POST", body: form })
}

/**
 * Where an element's asset id is served from.
 *
 * The id is reduced to a bare file name first. A document written by hand, or by an older tool, can
 * carry a full path where the app only ever writes a name, and the desktop resolves that same way:
 * whatever else it says, the file is looked for in the shared images directory.
 */
export function mindmapImagePath(assetId: string | null | undefined): string | null {
  const name = assetId?.split(/[\\/]/).pop()?.trim()
  return name ? `/api/mindmaps/assets/${encodeURIComponent(name)}` : null
}

/** A picture that is still coming, one that arrived, or one that is not there at all. */
export interface MindmapImage {
  readonly url: string | null
  readonly missing: boolean
}

/**
 * Loads an image's bytes and hands back a blob URL for them.
 *
 * Blob rather than a plain `src` because asset bytes sit behind the API's bearer token, which an
 * `<img>` cannot carry. Loading and gone are told apart, which the shared hook does not do, because
 * the canvas draws them differently: a blank box while the bytes are in flight, and a placeholder
 * saying so once the answer is that there is nothing there.
 */
export function useMindmapImage(assetId: string | null | undefined): MindmapImage {
  const path = mindmapImagePath(assetId)
  const [state, setState] = useState<MindmapImage>({ url: null, missing: false })

  useEffect(() => {
    setState({ url: null, missing: false })
    if (!path) {
      setState({ url: null, missing: true })
      return
    }

    let objectUrl: string | null = null
    let cancelled = false
    const controller = new AbortController()

    fetchAssetBlobUrl(path, controller.signal)
      .then((next) => {
        if (cancelled) {
          URL.revokeObjectURL(next)
          return
        }
        objectUrl = next
        setState({ url: next, missing: false })
      })
      .catch(() => {
        // An abort is this effect being torn down, not a missing file, and the state it would set
        // belongs to a path nobody is showing any more.
        if (!cancelled) {
          setState({ url: null, missing: true })
        }
      })

    return () => {
      cancelled = true
      controller.abort()
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [path])

  return state
}

/**
 * The box a placed image gets: its own proportions, scaled down to fit and never up.
 *
 * The same rule and the same numbers as the desktop, so a photo dropped on a map is the size it
 * would have been there. A picture bigger than the box comes in at a readable size and one smaller
 * than it keeps the pixels it has, since blowing up a 32 pixel icon to fill 360 helps nobody.
 */
export const IMAGE_FIT = { maxWidth: 360, maxHeight: 280, minSize: 40 } as const

export function fitImageBox(naturalWidth: number, naturalHeight: number): [number, number] {
  const { maxWidth, maxHeight, minSize } = IMAGE_FIT
  if (!(naturalWidth >= 1) || !(naturalHeight >= 1)) {
    return [maxWidth / 2, maxHeight / 2]
  }

  const scale = Math.min(1, maxWidth / naturalWidth, maxHeight / naturalHeight)
  return [
    Math.round(Math.max(minSize, naturalWidth * scale)),
    Math.round(Math.max(minSize, naturalHeight * scale)),
  ]
}

/**
 * The box for a file about to be placed, read from the file itself.
 *
 * Measured here rather than by the server, which would need an image decoder to answer a question
 * the machine holding the bytes can answer for nothing. A file that will not decode still gets a
 * box, because the upload succeeded and an element with no size is worse than one with a guess.
 */
export async function measureImageFile(file: File): Promise<[number, number]> {
  const url = URL.createObjectURL(file)
  try {
    const size = await new Promise<[number, number]>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve([image.naturalWidth, image.naturalHeight])
      image.onerror = () => reject(new Error("The image could not be read."))
      image.src = url
    })
    return fitImageBox(size[0], size[1])
  } catch {
    return fitImageBox(0, 0)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * The bytes as a data URI, for a picture that has to leave the app.
 *
 * An exported SVG is read on its own, without the app's token and often without the app running at
 * all, and a blob URL is refused outright inside an SVG loaded as an image, which is how the PNG is
 * rasterised. So the bytes travel in the file.
 */
export async function fetchImageDataUri(assetId: string): Promise<string | null> {
  const path = mindmapImagePath(assetId)
  if (!path) {
    return null
  }

  try {
    const blob = await fetchAssetBlob(path)
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error("The image could not be read."))
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}
