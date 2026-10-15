// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it } from "vitest"

import { cardAssetUrl, useImageFailure } from "./assets"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Probe({ url }: { url: string | null }) {
  const broken = useImageFailure(url)
  return <img src={url ?? undefined} alt={broken.failed ? "failed" : "ok"} onError={broken.onError} />
}

function mount(url: string | null) {
  const host = document.createElement("div")
  const root = createRoot(host)
  const render = (next: string | null) => act(() => root.render(<Probe url={next} />))
  render(url)
  return { img: () => host.querySelector("img")!, render, unmount: () => act(() => root.unmount()) }
}

describe("card asset urls", () => {
  it("names the cookie served route and encodes the id", () => {
    expect(cardAssetUrl("a b.png")).toBe("/api/flashcards/assets/a%20b.png")
    expect(cardAssetUrl(null)).toBeNull()
  })
})

describe("useImageFailure", () => {
  it("reports a failure for the url that failed and clears it for a new url", () => {
    const view = mount("/a.png")
    expect(view.img().alt).toBe("ok")

    act(() => {
      view.img().dispatchEvent(new Event("error"))
    })
    expect(view.img().alt).toBe("failed")

    view.render("/b.png")
    expect(view.img().alt).toBe("ok")
    view.unmount()
  })

  it("never reports a failure without a url", () => {
    const view = mount(null)
    act(() => {
      view.img().dispatchEvent(new Event("error"))
    })
    expect(view.img().alt).toBe("ok")
    view.unmount()
  })
})
