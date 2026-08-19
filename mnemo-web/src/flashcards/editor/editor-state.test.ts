import { describe, expect, it } from "vitest"

import { draftIsDirty, snapshotDraft } from "./editor-state"

const empty = () => snapshotDraft({ front: "", back: "", tags: [], attachments: [] })

describe("draftIsDirty", () => {
  it("is not dirty when nothing has changed", () => {
    expect(draftIsDirty(empty(), empty())).toBe(false)
  })

  it("is dirty once the front or back text changes", () => {
    const baseline = empty()
    expect(draftIsDirty(baseline, snapshotDraft({ front: "Q", back: "", tags: [], attachments: [] }))).toBe(true)
    expect(draftIsDirty(baseline, snapshotDraft({ front: "", back: "A", tags: [], attachments: [] }))).toBe(true)
  })

  it("is dirty when a tag is added, removed, or reordered", () => {
    const baseline = snapshotDraft({ front: "", back: "", tags: ["a", "b"], attachments: [] })
    expect(draftIsDirty(baseline, snapshotDraft({ front: "", back: "", tags: ["a", "b", "c"], attachments: [] }))).toBe(true)
    expect(draftIsDirty(baseline, snapshotDraft({ front: "", back: "", tags: ["a"], attachments: [] }))).toBe(true)
    expect(draftIsDirty(baseline, snapshotDraft({ front: "", back: "", tags: ["b", "a"], attachments: [] }))).toBe(true)
    expect(draftIsDirty(baseline, snapshotDraft({ front: "", back: "", tags: ["a", "b"], attachments: [] }))).toBe(false)
  })

  it("is dirty when an attachment is added or removed", () => {
    const baseline = snapshotDraft({ front: "", back: "", tags: [], attachments: [{ key: "x" }] })
    expect(draftIsDirty(baseline, snapshotDraft({ front: "", back: "", tags: [], attachments: [] }))).toBe(true)
    expect(
      draftIsDirty(baseline, snapshotDraft({ front: "", back: "", tags: [], attachments: [{ key: "x" }, { key: "y" }] })),
    ).toBe(true)
    expect(draftIsDirty(baseline, snapshotDraft({ front: "", back: "", tags: [], attachments: [{ key: "x" }] }))).toBe(false)
  })

  it("does not copy the input arrays by reference, so later mutation cannot retroactively taint a snapshot", () => {
    const tags = ["a"]
    const attachments = [{ key: "x" }]
    const baseline = snapshotDraft({ front: "", back: "", tags, attachments })

    tags.push("b")
    attachments.push({ key: "y" })

    expect(draftIsDirty(baseline, snapshotDraft({ front: "", back: "", tags: ["a"], attachments: [{ key: "x" }] }))).toBe(
      false,
    )
  })
})
