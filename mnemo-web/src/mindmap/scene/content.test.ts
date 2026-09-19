import { describe, expect, it } from "vitest"

import { defaultTextStyle } from "@/notes/model/types"

import type { ElementContent } from "../model/document"
import { bodyOf, runsOf } from "./content"

describe("runsOf", () => {
  it("fills in the style fields the wire leaves out, so a mark module never sees a missing colour", () => {
    // The storage serializer omits a colour that is null and a flag that is false; only what the
    // notes parser hands back can be turned into marks.
    const sparse = {
      $type: "text",
      text: "bold",
      runs: [{ kind: "text", text: "bold", style: { bold: true } }],
    } as unknown as ElementContent

    expect(runsOf(sparse)).toEqual([{ kind: "text", text: "bold", style: { ...defaultTextStyle, bold: true } }])
  })

  it("is null for a plain label and for a kind that has no label of its own", () => {
    expect(runsOf({ $type: "text", text: "plain" })).toBeNull()
    expect(runsOf({ $type: "task", text: "todo" })).toBeNull()
    expect(runsOf({ $type: "code", source: "x" })).toBeNull()
    expect(runsOf({ $type: "link", url: "https://x.test" })).toBeNull()
  })

  it("reads a legacy math row as one equation run", () => {
    expect(runsOf({ $type: "math", latex: "x^2" })).toEqual([
      { kind: "equation", latex: "x^2", style: { ...defaultTextStyle } },
    ])
  })

  it("decides the body from the runs", () => {
    expect(bodyOf({ $type: "text", text: "a" })).toBe("label")
    expect(bodyOf({ $type: "text", text: "a", runs: [{ kind: "text", text: "a", style: { ...defaultTextStyle } }] })).toBe("rich")
    expect(bodyOf({ $type: "math", latex: "a" })).toBe("rich")
    expect(bodyOf({ $type: "code", source: "a" })).toBe("code")
  })
})
