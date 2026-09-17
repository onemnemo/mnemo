import { apiFetch } from "@/api/client"

/** Mirrors Mnemo.Host/Contracts/MindmapDto.cs MindmapFindHitDto. */
export interface MindmapFindHit {
  elementId: string
  /** The indexed text that matched. */
  text: string
  /** Ancestor labels from the root down, joined with " > "; empty for a root or a free element. */
  path: string
}

/** Mirrors MindmapFindResultDto: the hits, and the revision they were read at. */
export interface MindmapFindResult {
  revision: number
  hits: MindmapFindHit[]
}

/**
 * Asks the server which of a map's elements say this, over the same full-text mirror the assistant
 * searches with. Not a scan of the scene: the mirror indexes what every element kind carries, a
 * caption, a code language, a link's address, and a scan here would be a second opinion on that.
 */
export function findInMindmap(mapId: string, query: string, signal?: AbortSignal): Promise<MindmapFindResult> {
  return apiFetch<MindmapFindResult>(
    `/mindmaps/${encodeURIComponent(mapId)}/find?q=${encodeURIComponent(query)}`,
    { signal },
  )
}
