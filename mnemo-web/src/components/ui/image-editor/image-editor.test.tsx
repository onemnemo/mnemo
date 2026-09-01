// @vitest-environment jsdom

/**
 * The dialog's contract with its callers: one request at a time, an answer on both buttons, and
 * no object url left alive after either.
 *
 * Everything mounts under StrictMode on purpose. The app runs under it, an effect cleanup with a
 * real side effect passes a plain render and breaks the running window, and the url bookkeeping
 * here is exactly the kind of thing that gets written into one.
 */

import { StrictMode, act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ImageEditorHost } from "./ImageEditorHost"
import { editImage, useImageEditorStore, type ImageEditResult } from "./store"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The decode probes the dialog opened, newest last. jsdom loads nothing on its own. */
const probes: FakeImage[] = []

class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  naturalWidth = 0
  naturalHeight = 0
  src = ""
  constructor() {
    probes.push(this)
  }
}

const nativeCreateObjectUrl = URL.createObjectURL
const nativeRevokeObjectUrl = URL.revokeObjectURL

let container: HTMLElement
let root: Root
let revoked: string[]
let madeUrls: number

beforeEach(() => {
  probes.length = 0
  revoked = []
  madeUrls = 0
  useImageEditorStore.setState({ pending: null })

  vi.stubGlobal("Image", FakeImage)
  URL.createObjectURL = () => {
    madeUrls += 1
    return `blob:mnemo/${String(madeUrls)}`
  }
  URL.revokeObjectURL = (url: string) => {
    revoked.push(url)
  }

  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(
      <StrictMode>
        <ImageEditorHost />
      </StrictMode>,
    )
  })
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.unstubAllGlobals()
  URL.createObjectURL = nativeCreateObjectUrl
  URL.revokeObjectURL = nativeRevokeObjectUrl
})

function open(request: Parameters<typeof editImage>[0]): { answer: () => ImageEditResult | null | undefined } {
  let answer: ImageEditResult | null | undefined
  act(() => {
    void editImage(request).then((result) => {
      answer = result
    })
  })
  return { answer: () => answer }
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

function stage(): HTMLElement | null {
  return document.querySelector('[role="application"]')
}

function presets(): HTMLElement | null {
  return document.querySelector('[role="radiogroup"]')
}

/** A button in the dialog by its label. Translations resolve to their own key on an empty bundle. */
function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    // Trimmed because a labelled button carries its icon's markup ahead of the words.
    (element) => (element.textContent ?? "").trim() === label,
  )
  expect(found, `no button labelled ${label}`).toBeDefined()
  return found as HTMLButtonElement
}

function click(element: HTMLElement): void {
  act(() => {
    element.click()
  })
}

function imageFile(name = "shot.png", size = 1024, type = "image/png"): File {
  const file = new File([new Uint8Array(1)], name, { type })
  Object.defineProperty(file, "size", { value: size })
  return file
}

/** Picks a file the way the hidden input reports one, since jsdom has no file chooser. */
function choose(file: File): void {
  const input = document.querySelector("input[type='file']")
  expect(input, "the picker input is not mounted").not.toBeNull()
  Object.defineProperty(input, "files", { value: [file], configurable: true })
  act(() => {
    input?.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

/** Answers the newest decode probe, which is the one StrictMode's second effect run opened. */
function decode(width: number, height: number): void {
  const probe = probes.at(-1)
  expect(probe, "no decode was started").toBeDefined()
  act(() => {
    if (!probe) return
    probe.naturalWidth = width
    probe.naturalHeight = height
    probe.onload?.()
  })
}

function press(key: string): void {
  const target = stage()
  expect(target, "the stage is not mounted").not.toBeNull()
  act(() => {
    target?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))
  })
}

describe("the image editor dialog", () => {
  it("stays out of the way until something asks", () => {
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it("opens on its own drop zone when the request brings no source", () => {
    open({ title: "Add an image" })

    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(stage()).toBeNull()
    expect(button("ImageEditorChoose")).toBeTruthy()
  })

  it("moves to the stage once a picked file decodes", () => {
    open({ title: "Add an image" })

    choose(imageFile())
    expect(stage(), "the stage was framed before the source decoded").toBeNull()

    decode(800, 400)
    expect(stage()).not.toBeNull()
  })

  it("runs the decode probe's effect twice on mount, which is why decode() answers the newest one", () => {
    open({ title: "Edit", src: "/api/notes/assets/a.png" })

    expect(probes.length, "StrictMode's double effect run on mount stopped happening").toBe(2)
  })

  it("offers the shape presets when the caller leaves the aspect open", () => {
    open({ title: "Edit", src: "/api/notes/assets/a.png" })
    decode(800, 400)

    expect(presets()).not.toBeNull()
  })

  it("hides the shape presets when the caller locks the aspect", () => {
    open({ title: "Edit", src: "/api/notes/assets/a.png", aspect: 30 / 7 })
    decode(800, 400)

    expect(stage()).not.toBeNull()
    expect(presets()).toBeNull()
  })

  it.each([NaN, 0])("never enables Save for a degenerate aspect of %s, and never settles at all", async (aspect) => {
    const request = open({ title: "Edit", src: "/api/notes/assets/a.png", aspect })
    decode(800, 400)

    expect(button("Save").disabled, `aspect ${String(aspect)} enabled Save`).toBe(true)

    click(button("Save"))
    await flush()

    expect(request.answer(), `aspect ${String(aspect)} settled anyway`).toBeUndefined()
  })

  it("leaves the view alone when a nudge has no overhang to move into", () => {
    // The frame here follows the decoded ratio exactly (no locked aspect, no stored crop), so at
    // zoom 1 the source covers with nothing left over on either axis: there is nowhere for an
    // arrow key to pan to, and Reset has nothing to reset.
    open({ title: "Edit", src: "/api/notes/assets/a.png" })
    decode(800, 400)

    expect(button("ImageEditorReset").disabled).toBe(true)

    press("ArrowRight")
    press("ArrowDown")

    expect(button("ImageEditorReset").disabled).toBe(true)
  })

  it("answers with the file that was picked and the crop that was framed", async () => {
    const request = open({ title: "Add an image" })

    choose(imageFile("diagram.png"))
    decode(800, 400)
    click(button("Save"))
    await flush()

    const answer = request.answer()
    expect(answer?.file?.name).toBe("diagram.png")
    expect(answer?.crop).toEqual({ x: 0, y: 0, w: 1, h: 1, aspect: 2 })
  })

  it("answers with a crop and no file when only the framing changed", async () => {
    const request = open({ title: "Edit", src: "/api/notes/assets/a.png", aspect: 1 })
    decode(800, 400)
    click(button("Save"))
    await flush()

    const answer = request.answer()
    expect(answer?.file).toBeNull()
    expect(answer?.crop.aspect).toBe(1)
    expect(answer?.crop.w).toBeCloseTo(0.5, 12)
  })

  it("reopens on the crop it was given", async () => {
    const stored = { x: 0.4, y: 0, w: 0.5, h: 1, aspect: 1 }
    const request = open({ title: "Edit", src: "/api/notes/assets/a.png", aspect: 1, crop: stored })
    decode(800, 400)
    click(button("Save"))
    await flush()

    const answer = request.answer()
    expect(answer?.crop.x).toBeCloseTo(stored.x, 12)
    expect(answer?.crop.w).toBeCloseTo(stored.w, 12)
  })

  it("answers null on cancel and lets go of the url it made", async () => {
    const request = open({ title: "Add an image" })

    choose(imageFile())
    decode(800, 400)
    expect(revoked, "the url was released while the dialog was still showing it").toEqual([])

    click(button("Cancel"))
    await flush()

    expect(request.answer()).toBeNull()
    expect(revoked).toEqual(["blob:mnemo/1"])
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it("lets go of the url on confirm as well, since the caller gets the file itself", async () => {
    open({ title: "Add an image" })

    choose(imageFile())
    decode(800, 400)
    click(button("Save"))
    await flush()

    expect(revoked).toEqual(["blob:mnemo/1"])
  })

  it("refuses a second request while one is open", async () => {
    open({ title: "First" })

    let second: ImageEditResult | null | undefined
    await act(async () => {
      second = await editImage({ title: "Second" })
    })

    expect(second).toBeNull()
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("First")
  })

  it("names the problem instead of taking an oversized file", () => {
    open({ title: "Add an image" })

    choose(imageFile("huge.png", 21 * 1024 * 1024))

    expect(document.body.textContent).toContain("ImageEditorTooLarge")
    expect(stage()).toBeNull()
    expect(madeUrls, "an unusable file still cost a url").toBe(0)
  })

  it("names the problem instead of taking a file it cannot show", () => {
    open({ title: "Add an image" })

    choose(imageFile("notes.txt", 512, "text/plain"))

    expect(document.body.textContent).toContain("ImageEditorUnsupported")
    expect(stage()).toBeNull()
  })

  it("replaces the source when a second file is picked mid edit", () => {
    open({ title: "Add an image" })

    choose(imageFile("first.png"))
    decode(800, 400)
    choose(imageFile("second.png"))

    expect(stage(), "the stage kept the old frame while the new source decoded").toBeNull()
    decode(400, 400)
    expect(stage()).not.toBeNull()
    expect(document.querySelector("[role='application'] img")?.getAttribute("src")).toBe("blob:mnemo/2")
  })
})
