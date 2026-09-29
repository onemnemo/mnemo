// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ImageBody } from "./ImageBody"

vi.mock("@/i18n/useT", () => ({ useT: () => (_ns: string, key: string) => key }))
vi.mock("../assets", () => ({ useMindmapImage: () => ({ url: "blob:pic", missing: false }) }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("an empty image", () => {
  it("is one card that asks for a file, worded like the notes card", () => {
    act(() => root.render(<ImageBody id="i" image={{ assetId: "", caption: null, crop: null }} slot menu />))
    const card = container.firstElementChild as HTMLElement

    expect(card.dataset.mmChrome).toBe("image")
    expect(card.textContent).toBe("ImagePlaceholder")
    expect(container.querySelector('[data-mm-chrome="imageMenu"]')).toBeNull()
  })
})

describe("a picture", () => {
  it("carries the options pill on an image element", () => {
    act(() => root.render(<ImageBody id="i" image={{ assetId: "a.png", caption: null, crop: null }} slot={false} menu />))
    const pill = container.querySelector<HTMLElement>('[data-mm-chrome="imageMenu"]')

    expect(pill?.getAttribute("aria-label")).toBe("ImageOptions")
  })

  it("has no pill on a node that only carries a picture", () => {
    act(() => root.render(<ImageBody id="i" image={{ assetId: "a.png", caption: null, crop: null }} slot={false} menu={false} />))

    expect(container.querySelector('[data-mm-chrome="imageMenu"]')).toBeNull()
  })
})
