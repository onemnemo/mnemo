import { describe, expect, it } from "vitest"

import {
  connectorStyle,
  DEFAULT_CONNECTOR,
  encodeConnector,
  parseConnector,
  toggleArrow,
  toggleBoth,
  toggleDashed,
} from "./connector"

describe("the connector pick", () => {
  it("draws what a connector has always drawn by default", () => {
    expect(connectorStyle(DEFAULT_CONNECTOR)).toEqual({
      line: "solid",
      routing: "curve",
      startCap: "none",
      endCap: "arrow",
    })
  })

  it("turns the arrow off and back on", () => {
    const bare = toggleArrow(DEFAULT_CONNECTOR)
    expect(connectorStyle(bare)).toMatchObject({ startCap: "none", endCap: "none" })
    expect(toggleArrow(bare).ends).toBe("end")
  })

  it("takes both arrows off when the arrow is turned off on a two-ended line", () => {
    expect(toggleArrow(toggleBoth(DEFAULT_CONNECTOR)).ends).toBe("none")
  })

  it("arrows both ends, and back to one", () => {
    const both = toggleBoth(DEFAULT_CONNECTOR)
    expect(connectorStyle(both)).toMatchObject({ startCap: "arrow", endCap: "arrow" })
    expect(toggleBoth(both).ends).toBe("end")
  })

  it("dashes the line without touching its route or ends", () => {
    const dashed = toggleDashed({ ...DEFAULT_CONNECTOR, routing: "orthogonal" })
    expect(connectorStyle(dashed)).toEqual({
      line: "dashed",
      routing: "orthogonal",
      startCap: "none",
      endCap: "arrow",
    })
  })

  it("survives a trip through the setting", () => {
    const pick = { routing: "straight", ends: "both", dashed: true } as const
    expect(parseConnector(encodeConnector(pick))).toEqual(pick)
  })

  it("falls back part by part on a value it cannot read", () => {
    expect(parseConnector("")).toEqual(DEFAULT_CONNECTOR)
    expect(parseConnector("spiral:both:dotted")).toEqual({ routing: "curve", ends: "both", dashed: false })
  })
})
