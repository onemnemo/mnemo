/**
 * Putting one palette on a whole map.
 *
 * A cluster can name a template of its own, which sits ahead of the document's in the cascade and
 * answers nearly every property before the document is asked. Nothing in the app writes one, but an
 * import and an assistant edit both can, and nothing on screen says a branch carries one, so a
 * document-only write leaves such a map looking as though the picker did nothing.
 *
 * Such a cluster has its override cleared rather than rewritten to the chosen palette: a pin copied
 * forward would keep shadowing every document-wide write from then on, permanently, on a map whose
 * author only ever asked for one palette. Only clusters already naming a template are touched, so
 * choosing a palette never hands an override to a cluster that had none.
 */

import { op } from "../model/ops"
import type { ClusterSettings } from "../model/document"
import type { MindmapOp } from "../model/ops"

export function palettePlan(templateId: string, clusters: readonly ClusterSettings[]): MindmapOp[] {
  const pinned = clusters.filter(
    (cluster) => cluster.templateId != null && cluster.templateId !== templateId,
  )
  return [
    op.layout({ template: templateId }),
    ...pinned.map((cluster) => op.layout({ root: cluster.rootId, template: "" })),
  ]
}
