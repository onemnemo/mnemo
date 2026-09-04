/**
 * The library's verb lists, checked without a DOM: what a map and a folder offer, in what
 * order, and that every label resolves against the real bundle, because translate.ts
 * answers a miss with the bare key and a menu row reading `Duplicate` would ship unnoticed.
 */

import { describe, expect, it, vi } from "vitest"

import { mergedEnglishBundle, resolves } from "@/i18n/test-bundle"
import type { TranslateFn } from "@/i18n/types"

import { folderMenuItems, mapMenuItems, type LibraryMenuEntry } from "./menu-items"

const t: TranslateFn = (_ns, key) => key

function ids(entries: readonly LibraryMenuEntry[]): string[] {
  return entries.map((entry) => entry.id)
}

function item(entries: readonly LibraryMenuEntry[], id: string) {
  const found = entries.find((entry) => entry.id === id)
  expect(found, `no entry ${id}`).toBeDefined()
  expect(found!.kind).toBe("item")
  return found as Extract<LibraryMenuEntry, { kind: "item" }>
}

describe("mapMenuItems", () => {
  const on = { rename: vi.fn(), duplicate: vi.fn(), export: vi.fn(), remove: vi.fn() }
  const entries = mapMenuItems({ t, on })

  it("offers rename, duplicate and export, then delete on its own below a rule", () => {
    expect(ids(entries)).toEqual(["rename", "duplicate", "export", "sep.delete", "delete"])
  })

  it("marks only delete as destructive", () => {
    expect(entries.filter((entry) => entry.kind === "item" && entry.danger).map((entry) => entry.id)).toEqual([
      "delete",
    ])
  })

  it("runs the handler each row was given", () => {
    item(entries, "rename").run()
    item(entries, "duplicate").run()
    item(entries, "export").run()
    item(entries, "delete").run()
    expect(on.rename).toHaveBeenCalledOnce()
    expect(on.duplicate).toHaveBeenCalledOnce()
    expect(on.export).toHaveBeenCalledOnce()
    expect(on.remove).toHaveBeenCalledOnce()
  })
})

describe("folderMenuItems", () => {
  const on = { rename: vi.fn(), remove: vi.fn() }
  const entries = folderMenuItems({ t, on })

  it("offers rename, then delete below a rule", () => {
    expect(ids(entries)).toEqual(["rename", "sep.delete", "delete"])
    expect(item(entries, "delete").danger).toBe(true)
  })

  it("runs the handler each row was given", () => {
    item(entries, "rename").run()
    item(entries, "delete").run()
    expect(on.rename).toHaveBeenCalledOnce()
    expect(on.remove).toHaveBeenCalledOnce()
  })
})

describe("the labels", () => {
  const bundle = mergedEnglishBundle()
  const handlers = { rename: () => {}, duplicate: () => {}, export: () => {}, remove: () => {} }
  const labels = [...mapMenuItems({ t, on: handlers }), ...folderMenuItems({ t, on: handlers })]
    .filter((entry): entry is Extract<LibraryMenuEntry, { kind: "item" }> => entry.kind === "item")
    .map((entry) => entry.label)

  it.each([...new Set(labels)])("resolves Mindmap/%s", (key) => {
    expect(resolves(bundle, "Mindmap", key), `Mindmap/${key} is missing`).toBe(true)
  })
})
