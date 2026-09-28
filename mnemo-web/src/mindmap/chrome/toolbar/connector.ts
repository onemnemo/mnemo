/** What the connect tool draws: a route plus three switches. */

import type { EdgeRouting, EdgeStyle } from "../../model/document"

export type ConnectorEnds = "none" | "end" | "both"

export interface ConnectorPick {
  readonly routing: EdgeRouting
  readonly ends: ConnectorEnds
  readonly dashed: boolean
}

export const DEFAULT_CONNECTOR: ConnectorPick = { routing: "curve", ends: "end", dashed: false }

const ROUTINGS: readonly EdgeRouting[] = ["curve", "straight", "orthogonal"]
const ENDS: readonly ConnectorEnds[] = ["none", "end", "both"]

/** Arrowed or not. Taking the arrow off a two-ended connector takes both off. */
export function toggleArrow(pick: ConnectorPick): ConnectorPick {
  return { ...pick, ends: pick.ends === "none" ? "end" : "none" }
}

/** Both ends or just the far one, since a connector with only a start arrow is the same line drawn backwards. */
export function toggleBoth(pick: ConnectorPick): ConnectorPick {
  return { ...pick, ends: pick.ends === "both" ? "end" : "both" }
}

export function toggleDashed(pick: ConnectorPick): ConnectorPick {
  return { ...pick, dashed: !pick.dashed }
}

export function connectorStyle(pick: ConnectorPick): EdgeStyle {
  return {
    line: pick.dashed ? "dashed" : "solid",
    routing: pick.routing,
    startCap: pick.ends === "both" ? "arrow" : "none",
    endCap: pick.ends === "none" ? "none" : "arrow",
  }
}

/** One setting string, `routing:ends:dashed`, since a setting holds text rather than a record. */
export function encodeConnector(pick: ConnectorPick): string {
  return `${pick.routing}:${pick.ends}:${pick.dashed ? "dashed" : "solid"}`
}

/** Each part falls back on its own, so a value from a newer build loses only what this one cannot read. */
export function parseConnector(value: string): ConnectorPick {
  const [routing, ends, line] = value.split(":")
  return {
    routing: ROUTINGS.find((known) => known === routing) ?? DEFAULT_CONNECTOR.routing,
    ends: ENDS.find((known) => known === ends) ?? DEFAULT_CONNECTOR.ends,
    dashed: line === "dashed",
  }
}
