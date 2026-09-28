import type { EdgeRouting, NodeShape, ShapeType } from "../../model/document"
import { EndsGlyph, LineGlyph, NodeShapeGlyph, RouteGlyph, ShapeGlyph } from "../glyphs"
import type { GroupId } from "./groups"

/** The sample an option is drawn as, from the same glyphs the edge and node bars use. */
export function OptionGlyph({ group, id, picked }: { group: GroupId; id: string; picked?: boolean }) {
  switch (group) {
    case "node":
      return <NodeShapeGlyph shape={id as NodeShape} />
    case "shape":
      return <ShapeGlyph shape={id as ShapeType} width={22} height={16} filled={picked} />
    case "connect":
      if (id === "arrow") {
        return <EndsGlyph start="none" end="arrow" />
      }
      if (id === "both") {
        return <EndsGlyph start="arrow" end="arrow" />
      }
      if (id === "dashed") {
        return <LineGlyph line="dashed" />
      }
      return <RouteGlyph routing={id as EdgeRouting} />
  }
}
