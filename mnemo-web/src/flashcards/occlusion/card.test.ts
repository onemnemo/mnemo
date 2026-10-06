import { describe, expect, it } from "vitest"

import type { CardDto, OcclusionDto } from "@/api/types"

import { askedMasks, canShowMasks, cardNumber, imageName, occlusionOf } from "./card"

const base: OcclusionDto = {
  mode: "hideAll",
  masks: [1, 2, 3, 4].map((n) => ({
    id: `m${n}`,
    shape: "rect" as const,
    x: 0,
    y: 0,
    w: 0.1,
    h: 0.1,
    points: null,
    label: null,
    group: null,
    order: n - 1,
  })),
  askedIds: ["m3"],
  back: "",
  imageAssetId: "a1",
}

function card(occlusion: OcclusionDto | null | undefined): CardDto {
  return {
    id: "c1",
    deckId: "d1",
    type: "occlusion",
    front: "",
    back: "",
    tags: [],
    state: "active",
    isFlagged: false,
    attachments: [],
    createdAt: "",
    updatedAt: "",
    occlusion,
  }
}

describe("occlusionOf", () => {
  it("is the payload when the image can be served", () => {
    expect(occlusionOf(card(base))).toBe(base)
  })

  it("is null for an ordinary card or an image the host cannot serve", () => {
    expect(occlusionOf(card(null))).toBeNull()
    expect(occlusionOf(card(undefined))).toBeNull()
    expect(occlusionOf(card({ ...base, imageAssetId: null }))).toBeNull()
  })
})

describe("canShowMasks", () => {
  it("is true only for hide all", () => {
    expect(canShowMasks(card(base))).toBe(true)
    expect(canShowMasks(card({ ...base, mode: "hideOne" }))).toBe(false)
    expect(canShowMasks(card(null))).toBe(false)
    expect(canShowMasks(null)).toBe(false)
  })
})

describe("asked masks", () => {
  it("are listed in mask order with the first one's badge number", () => {
    const group = { ...base, askedIds: ["m4", "m2"] }
    expect(askedMasks(group).map((mask) => mask.id)).toEqual(["m2", "m4"])
    expect(cardNumber(group)).toBe(2)
    expect(cardNumber(base)).toBe(3)
  })

  it("number a card 1 when its masks are gone", () => {
    expect(cardNumber({ ...base, askedIds: ["gone"] })).toBe(1)
  })
})

describe("imageName", () => {
  it("is the question as one plain line without its closing stop", () => {
    expect(imageName("Label the **parts**\nof a cell.", "Image occlusion")).toBe("Label the parts of a cell")
  })

  it("falls back when there is no question", () => {
    expect(imageName("  ", "Image occlusion")).toBe("Image occlusion")
  })

  it("is trimmed to a short name", () => {
    expect(imageName("word ".repeat(40), "x").length).toBeLessThanOrEqual(81)
  })
})
