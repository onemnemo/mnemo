// @vitest-environment jsdom

/**
 * Radix closes a menu after every select, which is wrong for a row that is one
 * tick among several: switching two languages on would cost two trips through
 * the menu. The wrapper used to discard the select event, so `preventDefault`
 * was unreachable from a caller. Checked here because the symptom is a menu
 * that vanishes rather than anything that throws.
 */

import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { Menu, MenuCheckItem, MenuContent, MenuTrigger } from "./menu"

vi.mock("@/i18n/useT", () => ({ useT: () => (_ns: string, key: string) => key }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLElement
let root: Root
let selects: number

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  selects = 0
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

/** Owns the open state the way a real menu's host does, so a close really unmounts. */
function Harness({ closeOnSelect, description }: { closeOnSelect?: boolean; description?: string }) {
  const [open, setOpen] = useState(true)
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger />
      <MenuContent>
        <MenuCheckItem
          checked={false}
          closeOnSelect={closeOnSelect}
          description={description}
          onSelect={() => {
            selects += 1
          }}
        >
          Norwegian
        </MenuCheckItem>
      </MenuContent>
    </Menu>
  )
}

function row(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[role='menuitemcheckbox']")
}

describe("a check item that stays put", () => {
  it("leaves the menu open across a select when closeOnSelect is false", () => {
    act(() => root.render(<Harness closeOnSelect={false} />))

    act(() => row()!.click())

    expect(selects).toBe(1)
    expect(row(), "the menu closed on a tick that asked to stay open").not.toBeNull()

    act(() => row()!.click())
    expect(selects).toBe(2)
  })

  it("closes the menu by default, as every other row does", () => {
    act(() => root.render(<Harness />))

    act(() => row()!.click())

    expect(selects).toBe(1)
    expect(row()).toBeNull()
  })
})

describe("a check item with a description", () => {
  it("puts it on a second line under the label", () => {
    act(() => root.render(<Harness description="English, Spanish" />))

    expect(row()!.textContent).toBe("NorwegianEnglish, Spanish")
  })

  it("renders one line when there is none", () => {
    act(() => root.render(<Harness />))

    expect(row()!.textContent).toBe("Norwegian")
  })
})
