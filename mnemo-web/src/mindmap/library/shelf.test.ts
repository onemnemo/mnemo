import { describe, expect, it } from "vitest"

import type { MindmapFolder, MindmapLibraryEntry } from "../model/document"
import { buildShelf, folderNames, recentMaps, resolveFolderId } from "./shelf"

function map(
  id: string,
  options: { folderId?: string | null; nodes?: number; modifiedAt?: string; title?: string } = {},
): MindmapLibraryEntry {
  return {
    document: {
      id,
      title: options.title ?? id,
      modifiedAt: options.modifiedAt,
      elements: Array.from({ length: options.nodes ?? 0 }, (_unused, index) => ({
        id: `${id}-${index}`,
        content: { $type: "text" as const, text: "" },
      })),
    },
    folderId: options.folderId ?? null,
  }
}

/** Root holds "loose"; "work" holds "brief" and nests "deep", which holds "spec". */
const folders: MindmapFolder[] = [
  { id: "work", name: "Work" },
  { id: "deep", name: "Deep", parentId: "work" },
  { id: "archive", name: "Archive" },
]

const entries: MindmapLibraryEntry[] = [
  map("loose", { modifiedAt: "2026-08-01", nodes: 3 }),
  map("brief", { folderId: "work", modifiedAt: "2026-08-05", nodes: 9 }),
  map("spec", { folderId: "deep", modifiedAt: "2026-08-09", nodes: 1 }),
]

describe("buildShelf", () => {
  it("shows the folders and maps filed at the level being viewed", () => {
    const shelf = buildShelf(entries, folders, { folderId: null, sort: "recent", search: "" })

    expect(shelf.folders.map((folder) => folder.id)).toEqual(["archive", "work"])
    expect(shelf.maps.map((entry) => entry.id)).toEqual(["loose"])
    expect(shelf.crumbs).toEqual([])
  })

  it("counts a folder by its whole subtree, not its direct children", () => {
    const shelf = buildShelf(entries, folders, { folderId: null, sort: "recent", search: "" })
    const work = shelf.folders.find((folder) => folder.id === "work")

    expect(work?.mapCount).toBe(2)
  })

  it("dates a folder by the newest map beneath it, and borrows that map as its preview", () => {
    const shelf = buildShelf(entries, folders, { folderId: null, sort: "recent", search: "" })
    const work = shelf.folders.find((folder) => folder.id === "work")

    expect(work?.modifiedAt).toBe("2026-08-09")
    expect(work?.preview?.id).toBe("spec")
  })

  it("leaves an empty folder undated rather than dating it now", () => {
    const shelf = buildShelf(entries, folders, { folderId: null, sort: "recent", search: "" })
    const archive = shelf.folders.find((folder) => folder.id === "archive")

    expect(archive?.mapCount).toBe(0)
    expect(archive?.modifiedAt).toBe("")
    expect(archive?.preview).toBeNull()
  })

  it("trails back to the root through every parent", () => {
    const shelf = buildShelf(entries, folders, { folderId: "deep", sort: "recent", search: "" })

    expect(shelf.crumbs).toEqual([
      { id: "work", name: "Work" },
      { id: "deep", name: "Deep" },
    ])
    expect(shelf.folder?.id).toBe("deep")
  })

  it("sorts maps by the mode asked for", () => {
    const here = entries.map((entry) => ({ ...entry, folderId: null }))

    expect(
      buildShelf(here, folders, { folderId: null, sort: "recent", search: "" }).maps.map((m) => m.id),
    ).toEqual(["spec", "brief", "loose"])
    expect(
      buildShelf(here, folders, { folderId: null, sort: "nodes", search: "" }).maps.map((m) => m.id),
    ).toEqual(["brief", "loose", "spec"])
    expect(
      buildShelf(here, folders, { folderId: null, sort: "name", search: "" }).maps.map((m) => m.id),
    ).toEqual(["brief", "loose", "spec"])
  })

  it("filters both folders and maps by the search, and still reports what is here", () => {
    const shelf = buildShelf(entries, folders, { folderId: null, sort: "recent", search: "arch" })

    expect(shelf.folders.map((folder) => folder.id)).toEqual(["archive"])
    expect(shelf.maps).toEqual([])
    expect(shelf.totalHere).toBe(3)
  })

  it("shows a map whose folder is gone at the root instead of nowhere", () => {
    const orphan = [map("stray", { folderId: "deleted-folder" })]
    const shelf = buildShelf(orphan, [], { folderId: null, sort: "recent", search: "" })

    expect(shelf.maps.map((entry) => entry.id)).toEqual([])
    expect(buildShelf(orphan, [], { folderId: "deleted-folder", sort: "recent", search: "" }).maps).toEqual([])
  })

  it("shows a folder whose parent is gone at the root", () => {
    const shelf = buildShelf([], [{ id: "loner", name: "Loner", parentId: "gone" }], {
      folderId: null,
      sort: "recent",
      search: "",
    })

    expect(shelf.folders.map((folder) => folder.id)).toEqual(["loner"])
  })
})

describe("resolveFolderId", () => {
  it("falls back to the root when the folder is no longer there", () => {
    expect(resolveFolderId(folders, "work")).toBe("work")
    expect(resolveFolderId(folders, "gone")).toBeNull()
    expect(resolveFolderId(folders, null)).toBeNull()
  })
})

describe("recentMaps", () => {
  it("takes the newest across every folder, not just the root", () => {
    expect(recentMaps(entries, 2).map((entry) => entry.id)).toEqual(["spec", "brief"])
  })
})

describe("folderNames", () => {
  it("names only the maps that are filed somewhere", () => {
    const names = folderNames(entries, folders)

    expect(names.get("brief")).toBe("Work")
    expect(names.has("loose")).toBe(false)
  })
})
