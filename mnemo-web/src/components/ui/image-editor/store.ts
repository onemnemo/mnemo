import { create } from "zustand"

import type { ImageCrop } from "./geometry"

/**
 * The image editor, as a promise.
 *
 * Imperative like the confirm dialog and for the same reason: threading open state and a pending
 * ref through four components to reach a hover button is how a codebase ends up with three image
 * editors that disagree about what Cancel does.
 *
 *   const next = await editImage({ src, aspect: COVER_ASPECT, title })
 *   if (next) setCover(next)
 */

export interface ImageEditRequest {
  /**
   * Left out, the dialog opens on its own drop zone instead of on the stage. Asset bytes sit
   * behind the api bearer token, which a bare img cannot carry, so this is a blob or data url the
   * caller already resolved. The dialog never revokes a url it was handed, only the ones it made.
   */
  src?: string
  /** Reopening starts from the crop already stored rather than from centred. */
  crop?: ImageCrop | null
  /** A number locks the frame shape and hides the preset row. */
  aspect?: number
  /** Already translated. The dialog is a primitive, so its callers own their own copy. */
  title: string
  /** The verb on the confirm button, already translated. Save when omitted. */
  confirm?: string
}

export interface ImageEditResult {
  /** The picture the user brought, or null when only the crop moved. Storing it is the caller's. */
  file: File | null
  crop: ImageCrop
}

interface PendingEdit extends ImageEditRequest {
  id: string
  resolve: (result: ImageEditResult | null) => void
}

interface ImageEditorState {
  pending: PendingEdit | null
  open: (request: ImageEditRequest) => Promise<ImageEditResult | null>
  settle: (id: string, result: ImageEditResult | null) => void
}

/**
 * Object URLs made for the open request, revoked when it settles on either answer: the result
 * hands back the File itself, so nothing outside the dialog is left pointing at these.
 *
 * Deliberately not an effect cleanup. StrictMode remounts the dialog, and a revoke there would
 * kill the url the live dialog is still showing.
 */
let owned: string[] = []

/** Makes a url for a picked file and takes responsibility for revoking it. */
export function ownSourceUrl(file: File): string {
  const url = URL.createObjectURL(file)
  owned.push(url)
  return url
}

function releaseOwned(): void {
  for (const url of owned) URL.revokeObjectURL(url)
  owned = []
}

let nextId = 0

export const useImageEditorStore = create<ImageEditorState>((set, get) => ({
  pending: null,
  open: (request) =>
    new Promise<ImageEditResult | null>((resolve) => {
      // A cropper on top of a cropper is a question about a question. The one already open wins,
      // the same way the browser's own confirm does.
      if (get().pending) {
        resolve(null)
        return
      }
      nextId += 1
      set({ pending: { ...request, id: String(nextId), resolve } })
    }),
  settle: (id, result) => {
    const request = get().pending
    if (!request || request.id !== id) return
    set({ pending: null })
    releaseOwned()
    request.resolve(result)
  },
}))

export function editImage(request: ImageEditRequest): Promise<ImageEditResult | null> {
  return useImageEditorStore.getState().open(request)
}
