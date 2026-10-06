// @vitest-environment jsdom

import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { isModalOpen } from "@/lib/modal"
import { dialog, useDialogStore } from "@/stores/dialog"

import { OCCLUSION_MAX_FIELD_LENGTH } from "../../../facts/occlusion"

import {
  button,
  byLabel,
  clearViewport,
  click,
  content,
  draftWith,
  mountLayout,
  pressEscape,
  press,
  rows,
  seedKeybinds,
  setViewport,
  text,
  unmountLayout,
  useEnglish,
} from "./chrome-harness"

vi.mock("../../../editor/assets", () => ({
  uploadCardAsset: vi.fn(),
  useCardAssetUrl: (id: string | null | undefined) => (id ? "blob:test" : null),
  useCardAsset: (id: string | null | undefined) => ({ url: (id ? "blob:test" : null), failed: false }),
}))

beforeEach(() => {
  useEnglish()
  seedKeybinds()
  setViewport(1280, 800)
})

afterEach(() => {
  unmountLayout()
  clearViewport()
})

const toolbar = () => document.querySelector('[role="toolbar"]')
const dock = () => document.querySelector('[role="group"][aria-label="View controls"]')

describe("OcclusionLayout empty state", () => {
  it("offers a drop zone, a picker and the paste hint, and hides the editing chrome", () => {
    mountLayout({ draft: draftWith(null, false), canSave: false })

    const zone = document.querySelector('[data-testid="occlusion-drop-zone"]')
    expect(text(zone)).toContain("Drop an image here")
    expect(button("Choose image")).toBeDefined()
    expect([...zone!.querySelectorAll("kbd")].map((cap) => cap.textContent)).toEqual(["Ctrl", "V"])

    expect(document.querySelector('[role="listbox"]')).toBeNull()
    expect(toolbar()).toBeNull()
    expect(dock()).toBeNull()
    expect(button("More")).toBeUndefined()
  })

  it("reads Makes no cards yet in the footer and keeps Save off", () => {
    mountLayout({ draft: draftWith(null, false), canSave: false })

    expect(text(document.body)).toContain("Makes no cards yet")
    expect(button("Save")?.disabled).toBe(true)
  })

  it("hands over the one image a drop, a paste or the picker brings", () => {
    const spies = mountLayout({ draft: draftWith(null, false), canSave: false })
    const file = new File(["x"], "cell.png", { type: "image/png" })
    const zone = document.querySelector('[data-testid="occlusion-drop-zone"]')!

    act(() => {
      const drop = new Event("drop", { bubbles: true, cancelable: true })
      Object.defineProperty(drop, "dataTransfer", { value: { files: [new File(["t"], "n.txt", { type: "text/plain" }), file], types: ["Files"] } })
      zone.dispatchEvent(drop)
    })
    expect(spies.onImage).toHaveBeenLastCalledWith(file)

    act(() => {
      const paste = new Event("paste", { bubbles: true, cancelable: true })
      Object.defineProperty(paste, "clipboardData", { value: { files: [file] } })
      content().dispatchEvent(paste)
    })
    expect(spies.onImage).toHaveBeenCalledTimes(2)

    const input = byLabel("Choose image") as HTMLInputElement
    Object.defineProperty(input, "files", { configurable: true, value: [file] })
    act(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(spies.onImage).toHaveBeenCalledTimes(3)
  })

  it("ignores a drop that carries no image", () => {
    const spies = mountLayout({ draft: draftWith(null, false), canSave: false })
    const zone = document.querySelector('[data-testid="occlusion-drop-zone"]')!

    act(() => {
      const drop = new Event("drop", { bubbles: true, cancelable: true })
      Object.defineProperty(drop, "dataTransfer", { value: { files: [new File(["t"], "n.txt", { type: "text/plain" })], types: ["Files"] } })
      zone.dispatchEvent(drop)
    })
    expect(spies.onImage).not.toHaveBeenCalled()
  })
})

describe("OcclusionLayout with an image", () => {
  it("lists the panel sections in order", () => {
    mountLayout()

    const labels = [...document.querySelectorAll("aside span, aside [role=radiogroup]")]
      .map((element) => element.getAttribute("aria-label") ?? element.textContent)
      .filter((label) => ["Front", "Study mode", "Cards", "Back", "TAGS"].includes(label ?? ""))
    expect(labels).toEqual(["Front", "Study mode", "Study mode", "Cards", "Back", "TAGS"])
    expect(document.querySelectorAll("aside textarea")).toHaveLength(2)
  })

  it("is 312px wide at full size and 288px below 1100", () => {
    mountLayout()
    expect(document.querySelector<HTMLElement>("aside")!.style.width).toBe("312px")
    unmountLayout()

    setViewport(1050, 800)
    mountLayout()
    expect(document.querySelector<HTMLElement>("aside")!.style.width).toBe("288px")
  })

  it("shows the tools, the view dock and the More menu", () => {
    mountLayout()

    expect(toolbar()).not.toBeNull()
    expect(dock()).not.toBeNull()
    expect(button("More")).toBeDefined()
    expect(rows()).toHaveLength(3)
  })

  it("switches the study mode and writes it into the masks", () => {
    const spies = mountLayout()
    expect(JSON.parse(spies.draft().values.masks).mode).toBe("hideAll")

    click(document.querySelector('[role="radio"][aria-checked="false"]')!)
    expect(JSON.parse(spies.draft().values.masks).mode).toBe("hideOne")
    expect(document.querySelector('[role="radio"][aria-checked="true"]')!.textContent).toBe("Hide one")
  })

  it("carries the full meaning of each mode in a tooltip", () => {
    mountLayout()
    const radios = [...document.querySelectorAll<HTMLElement>('[role="radio"]')]
    expect(radios.map((radio) => radio.getAttribute("data-tooltip"))).toEqual(["Hide all", "Hide one"])
    expect(radios[1].getAttribute("data-tooltip-detail")).toContain("Only the mask being asked is covered")
  })

  it("shows the notice when two cards would share a key", () => {
    const clash = draftWith({
      mode: "hideAll",
      masks: [
        { id: "aaaa1111", shape: "rect", x: 0.1, y: 0.1, w: 0.1, h: 0.1, order: 0 },
        { id: "bbbb2222", shape: "rect", x: 0.4, y: 0.1, w: 0.1, h: 0.1, order: 1, group: "aaaa1111" },
        { id: "cccc3333", shape: "rect", x: 0.7, y: 0.1, w: 0.1, h: 0.1, order: 2, group: "aaaa1111" },
      ],
    })
    mountLayout({ draft: clash })
    expect(text(document.querySelector('[role="status"]'))).toContain("make no card")
  })
})

describe("OcclusionLayout with masks over the size limit", () => {
  const oversized = () => ({ ...draftWith(null), values: { masks: " ".repeat(OCCLUSION_MAX_FIELD_LENGTH + 1) } })

  it("says so in the panel", () => {
    mountLayout({ draft: oversized(), canSave: false })

    expect(text(document.querySelector('[role="status"]'))).toContain("masks are too large to save")
  })

  it("says nothing at the limit", () => {
    mountLayout({ draft: { ...draftWith(null), values: { masks: " ".repeat(OCCLUSION_MAX_FIELD_LENGTH) } } })

    expect(document.querySelector('[role="status"]')).toBeNull()
  })
})

describe("OcclusionLayout footer", () => {
  it("counts the cards and appends the removals in the danger colour", () => {
    mountLayout({ loss: { removed: [{ key: "mx", layoutName: null, front: "", back: "", frontMedia: [], backMedia: [] }], kept: 2 } })

    expect(text(document.querySelector("footer, div.border-t"))).toContain("Makes 3 cards")
    const removes = document.querySelector('[data-testid="chip-removes"]')!
    expect(removes.textContent).toBe(", removes 1")
    expect(removes.className).toContain("text-danger")
  })

  it("says nothing about removals when nothing goes", () => {
    mountLayout()
    expect(document.querySelector('[data-testid="chip-removes"]')).toBeNull()
  })

  it("reads Makes 1 card for one mask", () => {
    mountLayout({
      draft: draftWith({ mode: "hideAll", masks: [{ id: "only1111", shape: "rect", x: 0.1, y: 0.1, w: 0.2, h: 0.2, order: 0 }] }),
    })
    expect(text(document.body)).toContain("Makes 1 card")
  })
})

describe("OcclusionLayout dismissal", () => {
  it("counts as an open modal for the keys underneath", () => {
    mountLayout()
    expect(isModalOpen()).toBe(true)
    expect(content().getAttribute("data-state")).toBe("open")
  })

  it("cancels an armed tool first, then the selection, and only then closes", () => {
    const spies = mountLayout()
    const armed = () => document.querySelector('[data-tb-tool][aria-pressed="true"]')?.getAttribute("data-tb-tool")

    press("r")
    expect(armed()).toBe("rect")
    click(rows()[0])
    expect(rows()[0].getAttribute("aria-selected")).toBe("true")

    pressEscape()
    expect(armed()).toBe("select")
    expect(rows()[0].getAttribute("aria-selected")).toBe("true")
    expect(spies.onOpenChange).not.toHaveBeenCalled()

    pressEscape()
    expect(rows()[0].getAttribute("aria-selected")).toBe("false")
    expect(spies.onOpenChange).not.toHaveBeenCalled()

    pressEscape()
    expect(spies.onOpenChange).toHaveBeenCalledWith(false)
  })

  it("saves on Ctrl+Enter", () => {
    const spies = mountLayout()
    press("Enter", { ctrlKey: true })
    expect(spies.onSave).toHaveBeenCalledTimes(1)
  })
})

describe("OcclusionLayout keys", () => {
  it("arms the tools from the keys the catalog binds", () => {
    mountLayout()
    const armed = () => document.querySelector('[data-tb-tool][aria-pressed="true"]')?.getAttribute("data-tb-tool")

    press("e")
    expect(armed()).toBe("ellipse")
    press("p")
    expect(armed()).toBe("polygon")
    press("h")
    expect(armed()).toBe("pan")
    press("v")
    expect(armed()).toBe("select")
  })

  it("toggles Show masks with M", () => {
    mountLayout()
    const toggle = () => byLabel("Show masks")
    expect(toggle().getAttribute("aria-pressed")).toBe("false")
    press("m")
    expect(toggle().getAttribute("aria-pressed")).toBe("true")
    press("m")
    expect(toggle().getAttribute("aria-pressed")).toBe("false")
  })

  it("leaves keys typed into a field alone", () => {
    mountLayout()
    const field = document.querySelector<HTMLTextAreaElement>("aside textarea")!
    const event = press("r", {}, field)
    expect(event.defaultPrevented).toBe(false)
    expect(document.querySelector('[data-tb-tool="rect"]')!.getAttribute("aria-pressed")).toBe("false")
  })

  it("lets only the editor's own keys through, not a menu's portalled ones", () => {
    mountLayout()
    const outside = document.createElement("div")
    document.body.append(outside)
    press("r", {}, outside)
    expect(document.querySelector('[data-tb-tool="rect"]')!.getAttribute("aria-pressed")).toBe("false")
    outside.remove()
  })
})

describe("OcclusionLayout in a wide window that is too short for the list", () => {
  it("moves only the Cards list, leaving the tool bar centred", () => {
    setViewport(1280, 500)
    mountLayout()

    expect(rows()).toHaveLength(0)
    expect(document.querySelector<HTMLElement>('[role="toolbar"]')!.parentElement!.style.left).toBe("50%")
    expect(document.querySelector<HTMLElement>("aside")!.style.width).toBe("312px")
  })
})

describe("OcclusionLayout against the modal's own box", () => {
  it("is not small in the content of a 1280x800 window", () => {
    // The modal is the window minus 3rem each way, less its 1px border on every side.
    setViewport(1280 - 48 - 2, 800 - 48 - 2)
    mountLayout()

    expect(rows()).toHaveLength(3)
    expect(document.querySelector<HTMLElement>("aside")!.style.width).toBe("312px")
  })

  it("is small in the content of a 900x600 window, by width", () => {
    setViewport(900 - 48 - 2, 600 - 48 - 2)
    mountLayout()

    expect(rows()).toHaveLength(0)
    expect(document.querySelector<HTMLElement>("aside")!.style.width).toBe("288px")
  })
})

describe("OcclusionLayout in a small window", () => {
  beforeEach(() => {
    unmountLayout()
    setViewport(900, 500)
    mountLayout()
  })

  it("moves the tool bar to the left and the Cards list out of the panel", () => {
    expect(rows()).toHaveLength(0)
    expect(document.querySelector<HTMLElement>('[role="toolbar"]')!.parentElement!.style.left).toBe("16px")
    expect(document.querySelector<HTMLElement>("aside")!.style.width).toBe("288px")
  })

  it("turns the footer chip into a button that opens the list", () => {
    const chip = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.startsWith("Makes"))!
    expect(chip).toBeDefined()
    click(chip)
    expect(rows()).toHaveLength(3)
  })

  it("opens the list on F2 with the selected card ready to rename", async () => {
    press("]")
    press("F2")
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(rows()).toHaveLength(3)
    expect(document.querySelector("input[data-inline-editor]")).not.toBeNull()
  })
})

describe("OcclusionLayout after a confirm dialog", () => {
  it("returns focus to the editor so the keys keep working", () => {
    vi.useFakeTimers()
    try {
      mountLayout()
      const armed = () => document.querySelector('[data-tb-tool][aria-pressed="true"]')?.getAttribute("data-tb-tool")
      content().focus()
      let answer: Promise<boolean> | undefined
      act(() => {
        answer = dialog.confirm({ title: "Discard this card?" })
      })
      // What a dialog that lost its opener leaves behind.
      ;(document.activeElement as HTMLElement | null)?.blur()
      expect(document.activeElement).toBe(document.body)

      const id = useDialogStore.getState().queue[0].id
      act(() => useDialogStore.getState().settle(id, false))
      act(() => {
        vi.advanceTimersByTime(100)
      })

      expect(document.activeElement).toBe(content())
      press("r")
      expect(armed()).toBe("rect")
      return answer
    } finally {
      vi.useRealTimers()
    }
  })
})
