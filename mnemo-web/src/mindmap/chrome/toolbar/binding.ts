/**
 * What each group's options mean against the choices the map editor holds, kept apart from the
 * markup because the three groups pick differently.
 */

import type { EdgeRouting, NodeShape, ShapeType } from "../../model/document"
import { toggleArrow, toggleBoth, toggleDashed, type ConnectorPick } from "./connector"
import type { GroupId } from "./groups"

export interface GroupBinding {
  isPicked(id: string): boolean
  /** The option the shelf names when nothing is pointed at, or null for the group's own name. */
  readonly captionId: string | null
  /** The option the tool wears as its face, when it wears one. */
  readonly faceId: string | null
  pick(id: string): void
}

export interface ToolChoices {
  readonly shape: ShapeType
  readonly nodeStyle: NodeShape | null
  readonly connector: ConnectorPick
}

export interface ToolChoiceSetters {
  readonly onShape: (shape: ShapeType) => void
  readonly onNodeStyle: (style: NodeShape | null) => void
  readonly onConnector: (pick: ConnectorPick) => void
}

const ROUTES: readonly string[] = ["curve", "straight", "orthogonal"]

export function bindGroup(group: GroupId, choices: ToolChoices, set: ToolChoiceSetters): GroupBinding {
  switch (group) {
    case "shape":
      return {
        isPicked: (id) => id === choices.shape,
        captionId: choices.shape,
        faceId: choices.shape,
        pick: (id) => set.onShape(id as ShapeType),
      }
    case "node":
      return {
        isPicked: (id) => id === choices.nodeStyle,
        captionId: choices.nodeStyle,
        faceId: null,
        // Pressing the picked style again hands new nodes back to the map's template.
        pick: (id) => set.onNodeStyle(id === choices.nodeStyle ? null : (id as NodeShape)),
      }
    case "connect": {
      const pick = choices.connector
      return {
        isPicked: (id) =>
          id === "arrow"
            ? pick.ends !== "none"
            : id === "both"
              ? pick.ends === "both"
              : id === "dashed"
                ? pick.dashed
                : id === pick.routing,
        captionId: pick.routing,
        faceId: pick.routing,
        pick: (id) =>
          set.onConnector(
            id === "arrow"
              ? toggleArrow(pick)
              : id === "both"
                ? toggleBoth(pick)
                : id === "dashed"
                  ? toggleDashed(pick)
                  : ROUTES.includes(id)
                    ? { ...pick, routing: id as EdgeRouting }
                    : pick,
          ),
      }
    }
  }
}
