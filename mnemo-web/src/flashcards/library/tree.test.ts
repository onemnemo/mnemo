import { describe, expect, it } from "vitest"

import type { DeckSummaryDto, FolderDto } from "@/api/types"

import { decksInFolderSubtree } from "./tree"

const folder = (id: string, parentId: string | null = null): FolderDto => ({ id, name: id, parentId, order: 0 })

// The helper reads only these two fields.
const deck = (id: string, folderId: string | null): DeckSummaryDto => ({ id, folderId }) as DeckSummaryDto

describe("decksInFolderSubtree", () => {
  const folders = [folder("lang"), folder("es", "lang"), folder("verbs", "es"), folder("other")]

  it("collects decks at every depth and nothing outside the folder", () => {
    const decks = [deck("a", "lang"), deck("b", "verbs"), deck("c", "other"), deck("d", null)]
    expect(decksInFolderSubtree("lang", folders, decks).map((d) => d.id)).toEqual(["a", "b"])
  })

  it("leaves out a deck whose folder no longer exists", () => {
    expect(decksInFolderSubtree("lang", folders, [deck("gone", "deleted")])).toEqual([])
  })

  it("survives folders that name each other as parent", () => {
    const looped = [folder("x", "y"), folder("y", "x")]
    expect(decksInFolderSubtree("x", looped, [deck("a", "y")]).map((d) => d.id)).toEqual(["a"])
  })
})
