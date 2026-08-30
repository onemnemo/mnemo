/**
 * Taking a map out of the app.
 *
 * Two of the three formats are made here and one is fetched, and the split is not arbitrary. A
 * picture of a map can only be made where the map was measured, which is the browser: the width of a
 * box is the width its label came out at in this document's fonts, and the server has neither. An
 * outline is a projection of the stored document that never asks how wide anything is, so it is the
 * server's, produced by the exporter the desktop already uses.
 */

import { exportRequest, saveExport, saveServerExport, type ExportOutcome, type ExportSaveOptions } from "@/api/export-file"

import { fetchImageDataUri } from "../assets"
import { imageRefOf } from "../scene/content"
import { canvasMeasurer, FONT_FAMILY, MONO_FAMILY } from "../scene/measure"
import { createColorFlattener } from "./colors"
import { inlineFonts } from "./fonts"
import { rasterize } from "./raster"
import { emitSvg, type SvgPicture } from "./svg"
import type { Scene } from "../model/scene"

export type MapExportFormat = "png" | "svg" | "markdown"

export interface MapExportRequest {
  readonly id: string
  readonly title: string
  /** What to draw. A selection is a scene of its own, projected the same way the whole map is. */
  readonly scene: Scene
  /** Leaves the paper out, for a picture that has to sit on something of its own. */
  readonly transparent?: boolean
  /** The chooser and overwrite copy. Passed in because the translations live in the UI, not here. */
  readonly save: ExportSaveOptions
}

/** The two families the emitter names, which are the two an embedded picture has to carry. */
const FACES = ["Inter", "Geist Mono"]

export async function exportMap(format: MapExportFormat, request: MapExportRequest): Promise<ExportOutcome> {
  if (format === "markdown") {
    // The grant rides in the query because the outline is a GET. Spent on sight and short lived,
    // so it is not a secret a URL can leak.
    return saveServerExport({ ...request.save, fileName: fileName(request.title, "md") }, (grant) =>
      exportRequest(
        `/mindmaps/${encodeURIComponent(request.id)}/outline${grant === null ? "" : `?grant=${encodeURIComponent(grant)}`}`,
      ),
    )
  }

  if (format === "svg") {
    const picture = draw(request, await collectImages(request.scene))
    return saveExport(new Blob([picture.markup], { type: "image/svg+xml;charset=utf-8" }), {
      ...request.save,
      fileName: fileName(request.title, "svg"),
    })
  }

  // Fonts go into the copy that gets rasterised and nowhere else. A saved .svg opened on a machine
  // with Inter on it looks right without them, and carrying a megabyte of font data in a file that
  // does not need it is a worse trade than the fallback.
  const [style, images] = await Promise.all([
    inlineFonts(FACES).catch(() => ""),
    collectImages(request.scene),
  ])
  return saveExport(await rasterize(draw(request, images, style)), {
    ...request.save,
    fileName: fileName(request.title, "png"),
  })
}

/**
 * The bytes of every picture on the map, keyed by the file each element names.
 *
 * Fetched up front because the emitter is synchronous, and by asset rather than by element so a
 * picture used twice is downloaded once. One that will not load is simply absent: an export that
 * fails outright because a single file went missing is worse than one that says where it was.
 */
async function collectImages(scene: Scene): Promise<ReadonlyMap<string, string>> {
  const wanted = new Set<string>()
  for (const element of scene.elements) {
    const image = imageRefOf(element.content)
    if (image && image.assetId) {
      wanted.add(image.assetId)
    }
  }

  const resolved = new Map<string, string>()
  await Promise.all(
    Array.from(wanted, async (assetId) => {
      const uri = await fetchImageDataUri(assetId)
      if (uri) {
        resolved.set(assetId, uri)
      }
    }),
  )
  return resolved
}

function draw(
  request: MapExportRequest,
  images: ReadonlyMap<string, string>,
  style?: string,
): SvgPicture {
  const colors = createColorFlattener()
  try {
    const picture = emitSvg(request.scene, {
      color: colors.flatten,
      measure: canvasMeasurer(FONT_FAMILY),
      measureMono: canvasMeasurer(MONO_FAMILY),
      background: request.transparent ? null : "var(--canvas)",
      style,
      image: (assetId) => images.get(assetId) ?? null,
    })
    if (!picture) {
      throw new Error("There is nothing on this map to export.")
    }
    return picture
  } finally {
    colors.dispose()
  }
}

/**
 * What the file lands under: the title, with anything a file system would refuse taken out. A map
 * called "?" leaves nothing behind, which is why there is a fallback under it.
 */
function fileName(title: string, extension: string): string {
  const name = title.replace(/[\\/:*?"<>|]/g, "_").trim() || "mindmap"
  return `${name}.${extension}`
}
