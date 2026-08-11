/**
 * What a map's branches are made of.
 *
 * Three names over two fields. A branch is either a stroke, a ribbon that thins as it goes, or a run
 * of right angles, and those are one decision to the person making the map even though the model
 * stores them as a width profile and a routing. Keeping the translation in one place means the
 * picker and the reader cannot drift apart, and it is the only file that has to change if a fourth
 * material ever turns up.
 */

import type { EdgeStyle } from "../model/document"

export type BranchMaterial = "line" | "taper" | "step"

export const BRANCH_MATERIALS: readonly { value: BranchMaterial; key: string }[] = [
  { value: "line", key: "BranchLine" },
  { value: "taper", key: "BranchTaper" },
  { value: "step", key: "BranchStep" },
]

/**
 * The edge defaults a material means.
 *
 * Both fields are always written, never just the one that differs. These are merged onto whatever
 * the canvas already carries, so a material that only said "taper" would leave a routing behind from
 * the material before it and produce a combination nobody picked.
 */
export function edgeDefaultsFor(material: BranchMaterial): EdgeStyle {
  switch (material) {
    case "taper":
      return { widthProfile: "taper", routing: "curve" }
    case "step":
      return { widthProfile: "uniform", routing: "orthogonal" }
    default:
      return { widthProfile: "uniform", routing: "curve" }
  }
}

/** Which material a map's stored defaults read as. A map that never chose one is drawn as a line. */
export function materialOf(defaults: EdgeStyle | null | undefined): BranchMaterial {
  if (defaults?.widthProfile === "taper") {
    return "taper"
  }
  if (defaults?.routing === "orthogonal") {
    return "step"
  }
  return "line"
}
