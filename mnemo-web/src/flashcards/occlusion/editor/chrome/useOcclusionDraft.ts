import { useEffect, useRef, useState } from "react"

import { useT } from "@/i18n/useT"
import { toast } from "@/stores/toast"

import { OCCLUSION_MAX_MASKS, parseOcclusion, serializeOcclusion } from "../../../facts/occlusion"
import { useOcclusionEditor, type OcclusionEditor } from "../useOcclusionEditor"

/**
 * The editor wired to the draft's Masks field: changes are written back, and a value changed from
 * outside (a hydrated fact, a cleared form) is loaded into the editor.
 */
export function useOcclusionDraft(
  masks: string,
  onMasks: (value: string) => void,
  onRename: (maskId: string) => void,
): OcclusionEditor {
  const t = useT()
  const written = useRef(masks)
  const [initial] = useState(() => parseOcclusion(masks))
  const editor = useOcclusionEditor(initial, {
    onChange: (document) => {
      written.current = serializeOcclusion(document)
      onMasks(written.current)
    },
    onRename,
    onFull: () => toast.warning(t("Flashcards", "OcclusionMaskLimit", { 0: OCCLUSION_MAX_MASKS })),
  })

  const { store } = editor
  useEffect(() => {
    if (masks === written.current) return
    written.current = masks
    store.reset(parseOcclusion(masks))
  }, [masks, store])

  return editor
}
