/**
 * Who wants to know that the camera moved, this frame.
 *
 * The runtime writes the camera straight to the DOM and tells the route once per frame, which is
 * how the minimap follows without a render. An open label editor needs the same tick for a
 * different reason: the chrome anchored to its caret (the formatting toolbar, the link flyout, the
 * symbol palette) sits on `document.body` in viewport coordinates and repositions on a scroll, and a
 * pan or a zoom under an open node is a scroll as far as that chrome is concerned. The editor is
 * mounted and torn down far from the route, so the tick goes through a listener set rather than a
 * prop.
 */

export interface CameraSignal {
  /** Runs `listener` on every camera tick until the returned function is called. */
  subscribe(listener: () => void): () => void
  emit(): void
}

export function createCameraSignal(): CameraSignal {
  const listeners = new Set<() => void>()
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emit() {
      for (const listener of listeners) {
        listener()
      }
    },
  }
}

/** The one signal the map route feeds. Only one map is ever on screen. */
export const cameraSignal: CameraSignal = createCameraSignal()
