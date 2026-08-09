import { useEffect } from "react"
import { create } from "zustand"

/** One segment of the breadcrumb. `href` omitted means the segment is where you already are. */
export interface Crumb {
  label: string
  icon?: string
  href?: string
}

interface TrailState {
  crumbs: Crumb[] | null
  setCrumbs: (crumbs: Crumb[] | null) => void
}

/**
 * The breadcrumb trail, owned by whichever module is on screen.
 *
 * A static module name is something the rail already told you. The trail is the
 * only thing in the frame that can say where you are *inside* a module, so the
 * module has to be the one filling it in; the frame only draws it, and falls back
 * to the module's own name until one is set.
 */
const useTrailStore = create<TrailState>((set) => ({
  crumbs: null,
  setCrumbs: (crumbs) => set({ crumbs }),
}))

export function useTrail(): Crumb[] | null {
  return useTrailStore((s) => s.crumbs)
}

/**
 * Publishes a trail for as long as the calling view is mounted, and clears it on
 * the way out so a stale trail never outlives the page that set it.
 */
export function usePublishTrail(crumbs: Crumb[]): void {
  // Serialised, so a caller can build the array inline without the effect firing
  // on every render.
  const key = JSON.stringify(crumbs)

  useEffect(() => {
    useTrailStore.getState().setCrumbs(JSON.parse(key) as Crumb[])
    return () => useTrailStore.getState().setCrumbs(null)
  }, [key])
}
