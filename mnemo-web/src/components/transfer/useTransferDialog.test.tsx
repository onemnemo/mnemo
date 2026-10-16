// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useConflictChoice, useExportFormat, useItemPhrase, useResetConflict } from "./useTransferDialog"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/i18n/useT", () => ({
  useT: () => (ns: string, key: string, params?: Record<string, string | number>) =>
    params ? `${ns}.${key}:${Object.values(params).join(",")}` : `${ns}.${key}`,
}))

let root: Root

let collisions = 1

beforeEach(() => {
  collisions = 1
  root = createRoot(document.createElement("div"))
})

afterEach(() => {
  act(() => root.unmount())
})

describe("useConflictChoice", () => {
  let choice: ReturnType<typeof useConflictChoice>

  function Harness() {
    choice = useConflictChoice()
    useResetConflict(collisions, choice.setConflict)
    return null
  }

  it("asks for a replace again after an edit but keeps the other choices", () => {
    act(() => root.render(<Harness />))
    act(() => choice.setConflict("Replace"))
    act(() => choice.onEdit())
    expect(choice.conflict).toBe("KeepBoth")

    act(() => choice.setConflict("Skip"))
    act(() => choice.onEdit())
    expect(choice.conflict).toBe("Skip")
  })

  it("forgets the choice once nothing collides", () => {
    act(() => root.render(<Harness />))
    act(() => choice.setConflict("Skip"))
    expect(choice.conflict).toBe("Skip")

    collisions = 0
    act(() => root.render(<Harness />))
    expect(choice.conflict).toBe("KeepBoth")
  })
})

describe("useExportFormat", () => {
  let result: ReturnType<typeof useExportFormat>
  const md = { formatId: "md" }
  const pdf = { formatId: "pdf" }

  function Harness({ available }: { available: { formatId: string }[] }) {
    result = useExportFormat(available)
    return null
  }

  it("picks the first format offered and corrects a pick that goes away", () => {
    const both = [md, pdf]
    act(() => root.render(<Harness available={both} />))
    expect(result[0]).toBe("md")

    act(() => result[1]("pdf"))
    expect(result[0]).toBe("pdf")

    act(() => root.render(<Harness available={[md]} />))
    expect(result[0]).toBe("md")
  })

  it("stays empty until something is offered", () => {
    act(() => root.render(<Harness available={[]} />))
    expect(result[0]).toBeNull()
  })
})

describe("useItemPhrase", () => {
  let phrase: (count: number) => string

  function Harness() {
    phrase = useItemPhrase("Notes")
    return null
  }

  it("uses the singular form for one and the counted form otherwise", () => {
    act(() => root.render(<Harness />))
    expect(phrase(1)).toBe("Common.TransferOneItemFormat:Notes.TransferNounSingular")
    expect(phrase(3)).toBe("Common.TransferManyItemsFormat:3,Notes.TransferNounPlural")
  })
})
