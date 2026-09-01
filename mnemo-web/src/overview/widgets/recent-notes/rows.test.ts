import { describe, expect, it } from "vitest"

import type { NoteFolderDto, NoteSummaryDto } from "@/api/types"

import { buildRecentNoteRows, folderPath, type RecentNoteOptions } from "./rows"

const NOW = new Date("2026-08-08T12:00:00Z").getTime()
const DAY = 24 * 60 * 60 * 1000

function note(overrides: Partial<NoteSummaryDto> & { id: string }): NoteSummaryDto {
  return {
    sid: overrides.id,
    ver: 1,
    title: "Note",
    folderId: null,
    parentNoteId: null,
    order: 0,
    isFavorite: false,
    emoji: null,
    cover: null,
    coverCrop: null,
    tags: [],
    createdAt: new Date(NOW).toISOString(),
    modifiedAt: new Date(NOW).toISOString(),
    ...overrides,
  }
}

function options(overrides: Partial<RecentNoteOptions> = {}): RecentNoteOptions {
  return {
    days: 7,
    limit: 5,
    sortBy: "modified",
    now: NOW,
    // Identity-ish, so a test can assert which timestamp reached the row without also asserting
    // how it was worded.
    formatDate: (timestamp) => timestamp,
    untitled: "Untitled",
    ...overrides,
  }
}

const folders: NoteFolderDto[] = [
  { id: "root", name: "Study", parentId: null, order: 0 },
  { id: "child", name: "Biology", parentId: "root", order: 0 },
]

describe("folderPath", () => {
  it("names every ancestor, outermost first", () => {
    expect(folderPath(folders, "child")).toBe("Study / Biology")
  })

  it("is empty at the library root", () => {
    expect(folderPath(folders, null)).toBe("")
  })

  it("stops at a parent that is not in the list", () => {
    expect(folderPath([{ id: "orphan", name: "Loose", parentId: "gone", order: 0 }], "orphan")).toBe("Loose")
  })

  it("terminates on a cycle instead of hanging the board", () => {
    const cycle: NoteFolderDto[] = [
      { id: "a", name: "A", parentId: "b", order: 0 },
      { id: "b", name: "B", parentId: "a", order: 0 },
    ]
    expect(folderPath(cycle, "a")).toBe("B / A")
  })
})

describe("buildRecentNoteRows", () => {
  it("keeps the window, orders newest first and stops at the limit", () => {
    const rows = buildRecentNoteRows(
      [
        note({ id: "old", modifiedAt: new Date(NOW - 9 * DAY).toISOString() }),
        note({ id: "middle", modifiedAt: new Date(NOW - 3 * DAY).toISOString() }),
        note({ id: "newest", modifiedAt: new Date(NOW - 1 * DAY).toISOString() }),
        note({ id: "older", modifiedAt: new Date(NOW - 5 * DAY).toISOString() }),
      ],
      [],
      options({ limit: 2 }),
    )

    expect(rows.map((row) => row.noteId)).toEqual(["newest", "middle"])
  })

  it("includes a note exactly on the cutoff", () => {
    const rows = buildRecentNoteRows(
      [note({ id: "edge", modifiedAt: new Date(NOW - 7 * DAY).toISOString() })],
      [],
      options(),
    )
    expect(rows).toHaveLength(1)
  })

  it("sorts and filters on the created date only for the literal 'date'", () => {
    const notes = [
      note({
        id: "recently-created",
        createdAt: new Date(NOW - 1 * DAY).toISOString(),
        modifiedAt: new Date(NOW - 30 * DAY).toISOString(),
      }),
      note({
        id: "recently-edited",
        createdAt: new Date(NOW - 30 * DAY).toISOString(),
        modifiedAt: new Date(NOW - 1 * DAY).toISOString(),
      }),
    ]

    expect(buildRecentNoteRows(notes, [], options({ sortBy: "date" })).map((r) => r.noteId)).toEqual([
      "recently-created",
    ])
    expect(buildRecentNoteRows(notes, [], options({ sortBy: "modified" })).map((r) => r.noteId)).toEqual([
      "recently-edited",
    ])
    // Anything unrecognized behaves as "modified", matching the desktop's ordinal comparison
    // against the single literal rather than a validation of the stored choice.
    expect(buildRecentNoteRows(notes, [], options({ sortBy: "whatever" })).map((r) => r.noteId)).toEqual([
      "recently-edited",
    ])
  })

  it("dates the row by the field it was selected on", () => {
    const created = new Date(NOW - 1 * DAY).toISOString()
    const modified = new Date(NOW - 30 * DAY).toISOString()
    const rows = buildRecentNoteRows(
      [note({ id: "n", createdAt: created, modifiedAt: modified })],
      [],
      options({ sortBy: "date" }),
    )

    // The desktop shows the modified date here, so a note surfaced for being new is labelled with
    // an edit from a month ago. The port shows the field that put it in the list.
    expect(rows[0].meta).toBe(created)
  })

  it("drops the separator entirely for a note at the library root", () => {
    const rows = buildRecentNoteRows([note({ id: "n", folderId: null })], folders, options())
    expect(rows[0].meta).toBe(new Date(NOW).toISOString())
    expect(rows[0].meta.startsWith(" ")).toBe(false)
  })

  it("writes the folder path ahead of the date, separated by a middle dot", () => {
    const rows = buildRecentNoteRows([note({ id: "n", folderId: "child" })], folders, options())
    expect(rows[0].meta).toBe(`Study / Biology · ${new Date(NOW).toISOString()}`)
  })

  it("falls back to the localized untitled label for a blank title", () => {
    const rows = buildRecentNoteRows([note({ id: "n", title: "   " })], [], options({ untitled: "Sin título" }))
    expect(rows[0].title).toBe("Sin título")
  })

  it("trims a title that has one", () => {
    const rows = buildRecentNoteRows([note({ id: "n", title: "  Cell biology  " })], [], options())
    expect(rows[0].title).toBe("Cell biology")
  })

  it("does not reorder the array it was given", () => {
    const notes = [note({ id: "a" }), note({ id: "b", modifiedAt: new Date(NOW - 1 * DAY).toISOString() })]
    buildRecentNoteRows(notes, [], options())
    // The list comes straight from the query cache; sorting it in place would reorder what every
    // other reader of that cache sees.
    expect(notes.map((n) => n.id)).toEqual(["a", "b"])
  })
})
