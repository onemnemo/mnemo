import { useRef, type ClipboardEvent, type DragEvent } from "react"

import { useT } from "@/i18n/useT"
import { toast } from "@/stores/toast"

// Some WebViews report no type for HEIC, AVIF and JFIF files, so the name stands in for it.
const IMAGE_EXTENSION = /\.(png|jpe?g|jfif|gif|webp|avif|heic|heif|bmp|svg|tiff?)$/i

function isImage(file: File): boolean {
  return file.type ? file.type.startsWith("image/") : IMAGE_EXTENSION.test(file.name)
}

/** Ways an image reaches the editor: a file picker, a paste and a drop. Each hands over one file. */
export function useImageIntake(onImage: (file: File) => void) {
  const t = useT()
  const picker = useRef<HTMLInputElement>(null)

  // Files that arrive but are not pictures are said so, since the image is what the form needs.
  const take = (files: FileList | readonly File[] | null | undefined): boolean => {
    const all = Array.from(files ?? [])
    if (all.length === 0) return false
    const file = all.find(isImage)
    if (file) onImage(file)
    else toast.warning(t("Flashcards", "OcclusionNotAnImage"))
    return true
  }

  return {
    picker,
    openPicker: () => picker.current?.click(),
    onPick: (files: FileList | null) => void take(files),
    /** True when the paste carried a file, so the caller can stop the browser handling it. */
    onPaste: (event: ClipboardEvent): boolean => {
      if (!take(event.clipboardData?.files)) return false
      event.preventDefault()
      return true
    },
    onDragOver: (event: DragEvent) => {
      if (Array.from(event.dataTransfer?.types ?? []).includes("Files")) event.preventDefault()
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault()
      take(event.dataTransfer?.files)
    },
  }
}
