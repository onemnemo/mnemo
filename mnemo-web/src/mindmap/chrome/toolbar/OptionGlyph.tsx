import { AppIcon } from "@/components/icon/AppIcon"

import type { EdgeRouting, NodeShape, ShapeType } from "../../model/document"
import { EndsGlyph, LineGlyph, NodeShapeGlyph, RouteGlyph, ShapeGlyph } from "../glyphs"
import type { GroupId } from "./groups"

/** The sample an option is drawn as, from the same glyphs the edge and node bars use. */
export function OptionGlyph({ group, id, picked }: { group: GroupId; id: string; picked?: boolean }) {
  switch (group) {
    case "select":
      return <AppIcon name={id === "lasso" ? "lasso" : "mouse-pointer-2"} size={16} strokeWidth={1.7} />
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
