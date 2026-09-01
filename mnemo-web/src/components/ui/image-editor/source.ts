/**
 * What the editor will take as a source.
 *
 * The same two rules the note asset endpoint applies, so a file that cannot be stored is refused
 * before anyone has framed a crop on it. The host checks magic numbers on top of these; this only
 * saves the doomed round trip.
 */

export const ACCEPTED_IMAGE_TYPES = "image/png,image/jpeg,image/gif,image/webp,image/bmp"

const ACCEPTED = new Set(ACCEPTED_IMAGE_TYPES.split(","))

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

/** The NotesEditor key naming why a file cannot be used, or null when it can. */
export function imageFileProblem(file: { type: string; size: number }): string | null {
  if (!ACCEPTED.has(file.type)) return "ImageEditorUnsupported"
  if (file.size > MAX_IMAGE_BYTES) return "ImageEditorTooLarge"
  return null
}

/**
 * The image in a drop or a paste. Falls back to the first file of any kind so a wrong one is
 * named rather than silently ignored; a gesture carrying both a picture and a text file is
 * still a picture.
 */
export function firstImageFile(files: FileList | readonly File[] | null | undefined): File | null {
  const list = files ? Array.from(files) : []
  return list.find((file) => ACCEPTED.has(file.type)) ?? list[0] ?? null
}
