// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { CardTypeDraft } from "../card-types"
import { CardTypeFields } from "./CardTypeFields"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/i18n/useT", () => ({ useT: () => (_ns: string, key: string) => key }))
vi.mock("@/components/icon/AppIcon", () => ({ AppIcon: () => null }))

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function draft(generator: string | null): CardTypeDraft {
  const field = (id: string) => ({ id, name: id, hint: "" })
  return {
    generator,
    sortFieldId: "front",
    fields: [field("image"), field("front"), field("back"), field("masks"), field("notes")],
  } as unknown as CardTypeDraft
}

function removeButtons(): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>('button[aria-label="CardTypesRemoveField"]')]
}

function render(generator: string | null): void {
  const noop = () => {}
  act(() =>
    root.render(
      <CardTypeFields
        draft={draft(generator)}
        onPatchField={noop}
        onMoveField={noop}
        onRemoveField={noop}
        onSetSortField={noop}
        onAddField={noop}
      />,
    ),
  )
}

describe("CardTypeFields", () => {
  it("keeps the fields image occlusion reads from being removed", () => {
    render("occlusion")
    expect(removeButtons().map((button) => button.disabled)).toEqual([true, true, true, true, false])
  })

  it("lets any field of another type go", () => {
    render(null)
    expect(removeButtons().every((button) => !button.disabled)).toBe(true)
  })
})
