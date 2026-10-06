import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import type { CardAttachmentDto, CardTypeDto } from "@/api/types"

import { generate, type FactLike } from "./generation"
import {
  OCCLUSION_MAX_MASKS,
  OCCLUSION_MAX_POINTS,
  buildOcclusionUnits,
  isValidOcclusionId,
  parseOcclusion,
  serializeOcclusion,
} from "./occlusion"

/**
 * The cases the C# side runs against the same fixture, so the two implementations cannot drift
 * apart on parsing, writing or the cards a document makes.
 */

interface ParseCase {
  name: string
  input: unknown
  canonical: string
}

interface GenerateCase {
  name: string
  image: boolean
  front: string
  masks: unknown
  expected: { key: string; front: string; back: string; members: string[][] }[]
}

const fixture = JSON.parse(
  readFileSync(
    new URL("../../../../Mnemo.Infrastructure.Tests/Flashcards/Fixtures/occlusion-generation.json", import.meta.url),
    "utf8",
  ),
) as { parse: ParseCase[]; generate: GenerateCase[] }

const occlusion: CardTypeDto = {
  id: "occlusion",
  name: "Image occlusion",
  isBuiltIn: true,
  fields: [
    { id: "image", name: "Image", hint: null },
    { id: "front", name: "Front", hint: "The question" },
    { id: "back", name: "Back", hint: "Shown with every answer" },
    { id: "masks", name: "Masks", hint: null },
  ],
  sortFieldId: "front",
  layouts: [],
  generator: "occlusion",
  generateFrom: "image",
  createdAt: "2026-01-01T00:00:00+00:00",
  updatedAt: "2026-01-01T00:00:00+00:00",
}

function image(id: string): CardAttachmentDto {
  return { id, side: "front", displayName: `${id}.png`, sizeBytes: 100, caption: null, assetId: `${id}.png` }
}

function asText(value: unknown): string | null {
  if (value === null) return null
  return typeof value === "string" ? value : JSON.stringify(value)
}

describe("the shared fixture", () => {
  it.each(fixture.parse.map((item) => [item.name, item] as const))("parses and writes: %s", (_name, item) => {
    expect(serializeOcclusion(parseOcclusion(asText(item.input)))).toBe(item.canonical)
  })

  it.each(fixture.generate.map((item) => [item.name, item] as const))("generates: %s", (_name, item) => {
    const material: FactLike = {
      values: { front: item.front, masks: asText(item.masks) ?? "" },
      media: item.image ? { image: [image("diagram")] } : {},
    }

    const cards = generate(occlusion, material)

    expect(cards.map((card) => ({ key: card.key, front: card.front, back: card.back }))).toEqual(
      item.expected.map((card) => ({ key: card.key, front: card.front, back: card.back })),
    )
    const units = cards.length === 0 ? [] : buildOcclusionUnits(parseOcclusion(material.values.masks)).units
    expect(units.map((unit) => [unit.members.map((m) => m.id)])).toEqual(item.expected.map((card) => card.members))
  })
})

describe("parseOcclusion", () => {
  it("ignores masks past the cap", () => {
    const masks = Array.from({ length: OCCLUSION_MAX_MASKS + 20 }, (_, i) => ({
      id: `m${i}`,
      shape: "rect",
      x: 0.1,
      y: 0.1,
      w: 0.1,
      h: 0.1,
      order: i,
    }))

    expect(parseOcclusion(JSON.stringify({ v: 1, masks })).masks).toHaveLength(OCCLUSION_MAX_MASKS)
  })

  it("ignores polygon points past the cap", () => {
    const points = Array.from({ length: OCCLUSION_MAX_POINTS + 30 }, (_, i) => [((i % 90) + 5) / 100, ((i % 50) + 5) / 100])

    const document = parseOcclusion(JSON.stringify({ v: 1, masks: [{ id: "p1", shape: "polygon", points }] }))

    expect(document.masks[0].points).toHaveLength(OCCLUSION_MAX_POINTS)
  })

  it("reads back what it wrote", () => {
    const first = parseOcclusion(JSON.stringify(fixture.parse[0].input))

    const second = parseOcclusion(serializeOcclusion(first))

    expect(second).toEqual(first)
    expect(second.masks[2]).toMatchObject({ x: 0.2, y: 0.2, w: 0.4, h: 0.6, label: "Wall" })
    expect(second.masks[2].points).toHaveLength(3)
  })

  it.each(fixture.parse.map((item) => [item.name, item.canonical] as const))(
    "treats the canonical text as a fixed point: %s",
    (_name, canonical) => {
      expect(serializeOcclusion(parseOcclusion(canonical))).toBe(canonical)
    },
  )
})

describe("buildOcclusionUnits", () => {
  it("reports a later unit that would reuse a key", () => {
    const set = buildOcclusionUnits(
      parseOcclusion(
        JSON.stringify({
          v: 1,
          masks: [
            { id: "x1", shape: "rect", x: 0.1, y: 0.1, w: 0.1, h: 0.1, order: 0 },
            { id: "y2", shape: "rect", x: 0.3, y: 0.1, w: 0.1, h: 0.1, group: "x1", order: 1 },
          ],
        }),
      ),
    )

    expect(set.units.map((unit) => unit.key)).toEqual(["mx1"])
    expect(set.collisions).toEqual(["mx1"])
  })
})

describe("isValidOcclusionId", () => {
  it.each([
    ["a1", true],
    ["k3f9a2b1", true],
    ["", false],
    ["A1", false],
    ["a-1", false],
    ["abcdefghijklmnopq", false],
  ])("%s -> %s", (id, valid) => {
    expect(isValidOcclusionId(id)).toBe(valid)
  })
})
