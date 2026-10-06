import { describe, expect, it } from "vitest"

import { buildOcclusionUnits, isValidOcclusionId, OCCLUSION_MAX_MASKS } from "../../facts/occlusion"
import { cardList } from "./cards"
import { perform } from "./perform"
import { createEditorStore } from "./store"
import { makeDoc, rect } from "./test-kit"

const METRICS = { box: { w: 1200, h: 800 }, fitted: { w: 1000, h: 500 }, natural: { w: 4000, h: 2000 } }

/** A small seeded generator, so a failing run can be replayed from its seed. */
function mulberry(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Kind = "keeps" | "shrinks" | "grows" | "any"

const keysOf = (store: ReturnType<typeof createEditorStore>) => cardList(store.doc()).map((card) => card.key)

function run(seed: number): void {
  const random = mulberry(seed)
  const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)]
  const store = createEditorStore(
    makeDoc(...Array.from({ length: 6 }, (_, i) => rect(`m${i}`, (i % 3) * 0.3, Math.floor(i / 3) * 0.4, 0.2, 0.2))),
    { random },
  )
  store.setMetrics(METRICS)

  const choose = (count: number) => {
    const ids = store.doc().masks.map((m) => m.id)
    const picked = new Set<string>()
    for (let i = 0; i < count && ids.length > 0; i++) picked.add(pick(ids))
    store.select([...picked])
  }

  const ops: [string, Kind, () => void][] = [
    ["move", "keeps", () => { choose(2); store.nudge(random() * 40 - 20, random() * 40 - 20) }],
    ["rename", "keeps", () => { choose(1); store.rename(store.getState().selection[0] ?? "", pick(["", "Golgi", "Rough ER"])) }],
    ["reorder", "keeps", () => { choose(2); perform(store, pick(["move-earlier", "move-later"] as const)) }],
    ["mode", "keeps", () => store.setMode(pick(["hideAll", "hideOne"] as const))],
    ["align", "keeps", () => { choose(4); store.align(pick(["left", "top", "centerHorizontal", "distributeVertical"] as const)) }],
    ["add", "grows", () => { store.addShape({ shape: pick(["rect", "ellipse"] as const), x: random() * 0.8, y: random() * 0.8, w: 0.1, h: 0.1 }) }],
    ["polygon", "grows", () => { perform(store, "tool-polygon"); store.addPoint([0.1, 0.1]); store.addPoint([0.5, 0.1]); store.addPoint([0.3, 0.6]); store.finishPolygon(); perform(store, "tool-select") }],
    ["duplicate", "grows", () => { choose(2); store.duplicateSelection() }],
    ["delete", "shrinks", () => { choose(2); store.deleteSelection() }],
    ["group", "shrinks", () => { choose(3); store.groupSelection() }],
    ["ungroup", "grows", () => { choose(3); store.ungroupSelection() }],
    ["undo", "any", () => store.undo()],
    ["redo", "any", () => store.redo()],
  ]

  for (let step = 0; step < 60; step++) {
    const before = keysOf(store)
    const [name, kind, act] = pick(ops)
    act()
    const after = keysOf(store)
    const doc = store.doc()
    const label = `seed ${seed} step ${step} ${name}`

    expect(buildOcclusionUnits(doc).collisions, label).toEqual([])
    expect(doc.masks.every((m) => isValidOcclusionId(m.id) && m.id.length >= 1), label).toBe(true)
    expect(new Set(doc.masks.map((m) => m.id)).size, label).toBe(doc.masks.length)
    expect(doc.masks.length, label).toBeLessThanOrEqual(OCCLUSION_MAX_MASKS)
    expect(new Set(after).size, label).toBe(after.length)
    expect(after.length, label).toBe(cardList(doc).length)
    expect(doc.masks.every((m) => m.x >= 0 && m.y >= 0 && m.x + m.w <= 1 + 1e-9 && m.y + m.h <= 1 + 1e-9), label).toBe(true)

    if (kind === "keeps") expect([...after].sort(), label).toEqual([...before].sort())
    if (kind === "grows") expect(before.every((key) => after.includes(key)), label).toBe(true)
    if (kind === "shrinks") expect(after.every((key) => before.includes(key)), label).toBe(true)
  }
}

describe("random edit sequences", () => {
  it("never change a surviving card's key or make two equal keys", () => {
    for (let seed = 1; seed <= 60; seed++) run(seed)
  })
})
