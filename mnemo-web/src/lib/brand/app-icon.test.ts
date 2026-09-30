import { describe, expect, it } from "vitest"

import { encodeIco, iconKey } from "./app-icon"

describe("iconKey", () => {
  it("ignores the accent for a banded logo", () => {
    expect(iconKey("forest", "teal")).toBe(iconKey("forest", "rose"))
  })

  it("changes with the accent for the accent logo", () => {
    expect(iconKey("accent", "teal")).not.toBe(iconKey("accent", "rose"))
  })
})

describe("encodeIco", () => {
  it("writes a directory entry per PNG pointing at its bytes", () => {
    const small = new Uint8Array([1, 2, 3])
    const large = new Uint8Array([4, 5, 6, 7])
    const ico = encodeIco([{ size: 16, png: small }, { size: 256, png: large }])
    const view = new DataView(ico.buffer)

    expect([view.getUint16(0, true), view.getUint16(2, true), view.getUint16(4, true)]).toEqual([0, 1, 2])
    expect([view.getUint8(6), view.getUint32(14, true), view.getUint32(18, true)]).toEqual([16, 3, 38])
    // 256 is stored as 0.
    expect([view.getUint8(22), view.getUint32(30, true), view.getUint32(34, true)]).toEqual([0, 4, 41])
    expect(Array.from(ico.subarray(38))).toEqual([1, 2, 3, 4, 5, 6, 7])
  })
})
