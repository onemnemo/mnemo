import type { NodeShape, ShapeType } from "../model/document"
import { op, type MindmapOp } from "../model/ops"
import type { MindmapTool } from "../interaction/tool"

/**
 * A planted shape's box. Bigger than a node's, because a shape is a region drawn around a label, and
 * one dragged out to nothing could not be seen to resize.
 */
const NEW_SHAPE_SIZE: [number, number] = [148, 86]

/** An empty image's box: room for the card's glyph and label, near the size most pictures land at. */
export const IMAGE_SLOT_SIZE: [number, number] = [240, 160]

/** What an armed tool creates, and what the undo entry for it is called. */
export const PLANT_LABEL: Partial<Record<MindmapTool, string>> = {
  node: "AddNode",
  text: "AddText",
  shape: "ToolShape",
  image: "ToolImage",
}

export interface PlantChoices {
  readonly shape: ShapeType
  /** The node style the toolbar has picked, or null to leave the node to its template and theme. */
  readonly nodeStyle: NodeShape | null
}

export function plantOp(tool: MindmapTool, xy: [number, number], choices: PlantChoices): MindmapOp {
  if (tool === "shape") {
    return op.addElement("shape", xy[0], xy[1], { $type: "shape", shape: choices.shape }, {
      ref: "n",
      // Sized up front, since a shape is a region rather than a box measured around its text, and
      // the projector has no label to measure one from.
      wh: NEW_SHAPE_SIZE,
    })
  }
  if (tool === "image") {
    // Centred, since a box this big with its corner at the pointer lands mostly beside the spot.
    const [width, height] = IMAGE_SLOT_SIZE
    return op.addElement(
      "image",
      Math.round(xy[0] - width / 2),
      Math.round(xy[1] - height / 2),
      { $type: "canvasImage", assetId: "" },
      { ref: "n", wh: IMAGE_SLOT_SIZE },
    )
  }
  if (tool === "text") {
    return op.addElement("text", xy[0], xy[1], { $type: "freeText", text: "" }, { ref: "n" })
  }
  const style = choices.nodeStyle ? { nodeShape: choices.nodeStyle } : undefined
  // Unpinned: a node dropped by hand stays where it lands until an Arrange, and still takes part in one.
  return op.addNodes([{ ref: "n", t: "", xy, pin: false, style }])
}
