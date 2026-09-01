import { ImageEditorDialog } from "./ImageEditorDialog"
import { useImageEditorStore } from "./store"

/**
 * Mounted once beside the app's other overlays, empty until something asks.
 *
 * The dialog unmounts between requests, so nothing survives from the last picture, and the store
 * refuses a second request while one is open, so there is always a gap here rather than one
 * request replacing another mid edit.
 */
export function ImageEditorHost() {
  const request = useImageEditorStore((state) => state.pending)
  const settle = useImageEditorStore((state) => state.settle)

  if (!request) return null

  return (
    // Deliberately no settle-on-unmount: this host lives for the app's whole lifetime, and a
    // naive effect cleanup here would settle on StrictMode's first cleanup pass and close the
    // dialog in dev.
    <ImageEditorDialog
      key={request.id}
      request={request}
      onSettle={(result) => {
        settle(request.id, result)
      }}
    />
  )
}
