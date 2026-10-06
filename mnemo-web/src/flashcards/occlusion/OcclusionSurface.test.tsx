// @vitest-environment jsdom

/**
 * Mounts the real review card over an image occlusion payload shaped as the host serves it.
 * Layout needs a browser, so these pin what jsdom can: which masks are drawn in which state,
 * the controls, the accessible names, and that dragging the image is never a reveal.
 */

import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { CardDto, OcclusionMaskDto } from "@/api/types"

import { CardSurface } from "../session/components/CardSurface"
import { failImages, loadImages } from "./image-test-helpers"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/i18n/useT", () => ({
  useT: () => (_ns: string, key: string, params?: Record<string, string | number>) =>
    params ? `${key} ${JSON.stringify(params)}` : key,
}))

vi.mock("@/settings/store", () => ({
  useSettingValue: (_key: string, fallback: string) => fallback,
}))

vi.mock("@/components/icon/AppIcon", () => ({
  AppIcon: ({ name }: { name: string }) => <span data-icon={name} />,
}))

const asset = vi.hoisted(() => ({ failed: false }))

vi.mock("../editor/assets", () => ({
  useCardAssetUrl: () => "blob:plant-cell",
  useCardAsset: () => (asset.failed ? { url: null, failed: true } : { url: "blob:plant-cell", failed: false }),
}))

function mask(id: string, order: number, extra: Partial<OcclusionMaskDto> = {}): OcclusionMaskDto {
  return {
    id,
    shape: "rect",
    x: 0.03,
    y: 0.1 + order * 0.1,
    w: 0.2,
    h: 0.05,
    points: null,
    label: null,
    group: null,
    order,
    ...extra,
  }
}

const masks: OcclusionMaskDto[] = [
  mask("m1", 0),
  mask("m2", 1, { shape: "ellipse" }),
  mask("m3", 2),
  mask("m4", 3, { label: "Rough ER" }),
  mask("m5", 4, {
    shape: "polygon",
    x: 0.6,
    y: 0.2,
    w: 0.1,
    h: 0.07,
    points: [
      [0.6, 0.2],
      [0.7, 0.21],
      [0.65, 0.27],
    ],
  }),
]

function occlusionCard(over: Partial<CardDto> = {}, askedIds = ["m4"], mode: "hideAll" | "hideOne" = "hideAll"): CardDto {
  return {
    id: "card-1",
    deckId: "deck-1",
    type: "occlusion",
    front: "Label the parts of a plant cell.",
    back: "Rough ER",
    tags: [],
    state: "active",
    isFlagged: false,
    attachments: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    occlusion: {
      mode,
      masks,
      askedIds,
      back: "Plant cells have a cell wall.",
      imageAssetId: "asset-1",
    },
    ...over,
  }
}

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
  vi.unstubAllGlobals()
  asset.failed = false
})

interface Handlers {
  onReveal: () => void
  onToggleMasks: () => void
}

function render(
  card: CardDto,
  revealed = false,
  showMasks = false,
  handlers: Partial<Handlers> = {},
  decode = true,
): Handlers {
  const bound: Handlers = { onReveal: vi.fn(), onToggleMasks: vi.fn(), ...handlers }
  act(() =>
    root.render(
      <StrictMode>
        <CardSurface
          card={card}
          revealed={revealed}
          canUndo={false}
          showMasks={showMasks}
          onToggleMasks={bound.onToggleMasks}
          onReveal={bound.onReveal}
          onEdit={() => {}}
          onFlag={() => {}}
          onUndo={() => {}}
        />
      </StrictMode>,
    ),
  )
  if (decode) loadImages(host)
  return bound
}

/** Mask id to state, since polygons draw in their own layer ahead of the boxes. */
const states = () =>
  Object.fromEntries([...host.querySelectorAll<SVGElement | HTMLElement>("[data-mask]")].map((el) => [el.getAttribute("data-mask"), el.getAttribute("data-state")]))
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
const stage = () => host.querySelector<HTMLElement>('[data-testid="occlusion-stage"]')!

function pointer(type: string, x: number, y: number, buttons = type === "pointerup" ? 0 : 1): void {
  stage().dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, buttons }))
}

describe("an image occlusion card in review", () => {
  it("covers every mask and marks the asked one with a question mark before the reveal", () => {
    render(occlusionCard())

    expect(states()).toEqual({ m1: "covered", m2: "covered", m3: "covered", m4: "asked", m5: "covered" })
    expect(host.querySelector('[data-mask="m4"]')?.textContent).toBe("?")
    expect(host.querySelectorAll('[data-state="asked"]')).toHaveLength(1)
  })

  it("shows the question as text above the image", () => {
    render(occlusionCard())

    expect(host.textContent).toContain("Label the parts of a plant cell.")
  })

  it("outlines the answer and shows the label and the back text once revealed", () => {
    render(occlusionCard(), true)

    expect(host.querySelector('[data-mask="m4"]')?.getAttribute("data-state")).toBe("answer")
    expect(host.querySelector('[data-mask="m4"]')?.textContent).toBe("")
    expect(host.textContent).toContain("Rough ER")
    expect(host.textContent).toContain("Plant cells have a cell wall.")
  })

  it("reserves the answer's room before the reveal without exposing it", () => {
    render(occlusionCard(), false)

    const reserved = host.querySelector<HTMLElement>(".invisible")
    expect(reserved).not.toBeNull()
    expect(reserved!.getAttribute("aria-hidden")).toBe("true")

    render(occlusionCard(), true)
    expect(host.querySelector(".invisible")).toBeNull()
  })

  it("says No label when the asked mask has none", () => {
    render(occlusionCard({ back: "" }), true)

    expect(host.textContent).toContain("OcclusionNoLabel")
  })

  it("draws only the asked mask in hide one, and offers no Show masks", () => {
    render(occlusionCard({}, ["m4"], "hideOne"), false, true)

    expect(states()).toEqual({ m4: "asked" })
    expect(button("StudyShowMasks")).toBeNull()
  })

  it("asks every member of a group at once", () => {
    render(occlusionCard({ back: "Rough ER, Ribosomes" }, ["m3", "m4"]))

    expect(Object.values(states()).filter((state) => state === "asked")).toHaveLength(2)
    expect(host.querySelectorAll("[data-mask]")).toHaveLength(masks.length)
  })

  it("outlines the other masks when Show masks is on, and asks the page to toggle them", () => {
    const handlers = render(occlusionCard(), false, true)

    expect(states()).toEqual({ m1: "shown", m2: "shown", m3: "shown", m4: "asked", m5: "shown" })
    const toggle = button("StudyShowMasks")!
    expect(toggle.getAttribute("aria-pressed")).toBe("true")
    act(() => toggle.click())
    expect(handlers.onToggleMasks).toHaveBeenCalledTimes(1)
  })

  it("keeps a revealed answer ringed while other masks are shown", () => {
    render(occlusionCard(), true, true)

    expect(states()).toEqual({ m1: "shown", m2: "shown", m3: "shown", m4: "answer", m5: "shown" })
  })

  it("offers Fit only while zoomed", () => {
    render(occlusionCard())
    expect(button("StudyFit")).toBeNull()

    act(() => button("StudyZoomIn")!.click())
    expect(button("StudyFit")).not.toBeNull()

    act(() => button("StudyFit")!.click())
    expect(button("StudyFit")).toBeNull()
  })

  it("does not reveal when the corner buttons are used", () => {
    const handlers = render(occlusionCard())

    act(() => button("StudyZoomIn")!.click())
    act(() => button("StudyShowMasks")!.click())

    expect(handlers.onReveal).not.toHaveBeenCalled()
  })

  it("keeps the card on the front when Zoom in is clicked on its icon", () => {
    const handlers = render(occlusionCard())
    const zoom = button("StudyZoomIn")!
    // A real click lands on the icon's SVG, which is not an HTMLElement.
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    zoom.append(icon)

    act(() => icon.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(button("StudyFit")).not.toBeNull()
    expect(handlers.onReveal).not.toHaveBeenCalled()
  })

  it("keeps the card on the front when the click's target was removed by the re-render", () => {
    const handlers = render(occlusionCard())
    const zoom = button("StudyZoomIn")!
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    zoom.append(icon)
    // Detaches the target in the middle of the click, ahead of the card's own handler.
    zoom.addEventListener("click", () => icon.remove())

    act(() => icon.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(handlers.onReveal).not.toHaveBeenCalled()
  })

  it("keeps the zoom when the answer is revealed", () => {
    render(occlusionCard())
    act(() => button("StudyZoomIn")!.click())

    render(occlusionCard(), true)

    expect(button("StudyFit")).not.toBeNull()
  })

  it("reveals on a plain click on the image", () => {
    const handlers = render(occlusionCard())

    act(() => {
      pointer("pointerdown", 100, 100)
      pointer("pointerup", 100, 100)
      stage().click()
    })

    expect(handlers.onReveal).toHaveBeenCalledTimes(1)
  })

  it("does not reveal when the image is dragged, and reveals on the next plain click", () => {
    const handlers = render(occlusionCard())

    act(() => {
      pointer("pointerdown", 100, 100)
      pointer("pointermove", 140, 110)
      pointer("pointerup", 140, 110)
      stage().click()
    })
    expect(handlers.onReveal).not.toHaveBeenCalled()

    act(() => {
      pointer("pointerdown", 100, 100)
      pointer("pointerup", 100, 100)
      stage().click()
    })
    expect(handlers.onReveal).toHaveBeenCalledTimes(1)
  })

  it("treats a tiny wobble as a click", () => {
    const handlers = render(occlusionCard())

    act(() => {
      pointer("pointerdown", 100, 100)
      pointer("pointermove", 102, 101)
      pointer("pointerup", 102, 101)
      stage().click()
    })

    expect(handlers.onReveal).toHaveBeenCalledTimes(1)
  })

  it("leaves a plain wheel to scroll the column, and takes it once zoomed", () => {
    render(occlusionCard())

    const plain = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100 })
    stage().dispatchEvent(plain)
    expect(plain.defaultPrevented).toBe(false)

    act(() => button("StudyZoomIn")!.click())
    const zoomed = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100 })
    act(() => {
      stage().dispatchEvent(zoomed)
    })
    expect(zoomed.defaultPrevented).toBe(true)
  })

  it("names the image for assistive tech with the card, then the answer once revealed", () => {
    render(occlusionCard())
    const front = stage().getAttribute("aria-label")!
    expect(front).toContain("StudyOcclusionImageOne")
    expect(front).toContain('"name":"Label the parts of a plant cell"')
    expect(front).toContain('"number":4')

    render(occlusionCard(), true)
    const back = stage().getAttribute("aria-label")!
    expect(back).toContain("StudyOcclusionAnswer")
    expect(back).toContain('"label":"Rough ER"')
  })

  it("names a group of masks by how many are asked together", () => {
    render(occlusionCard({ back: "Rough ER, Ribosomes" }, ["m3", "m4"]))

    const label = stage().getAttribute("aria-label")!
    expect(label).toContain("StudyOcclusionImageMany")
    expect(label).toContain('"count":2')
    expect(label).toContain('"number":3')
  })

  it("is not shown for a card without a servable image", () => {
    render(occlusionCard({ occlusion: { ...occlusionCard().occlusion!, imageAssetId: null } }))

    expect(host.querySelector('[data-testid="occlusion-stage"]')).toBeNull()
  })

  it("puts the answer beside the image in a short window", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("max-height"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))

    render(occlusionCard(), true)

    expect(host.querySelector(".invisible")).toBeNull()
    const beside = host.querySelector<HTMLElement>(".border-l")
    expect(beside?.textContent).toContain("Rough ER")
  })

  it("does not swallow the next click after a cancelled gesture", () => {
    const handlers = render(occlusionCard())

    act(() => {
      pointer("pointerdown", 100, 100)
      pointer("pointermove", 160, 100)
      pointer("pointercancel", 160, 100)
    })
    act(() => stage().click())

    expect(handlers.onReveal).toHaveBeenCalledTimes(1)
  })

  it("draws no masks until the image has decoded, and says so when it cannot load", () => {
    render(occlusionCard(), false, false, {}, false)
    expect(host.querySelectorAll("[data-mask]")).toHaveLength(0)

    failImages(host)
    expect(host.textContent).toContain("StudyOcclusionImageFailed")
    expect(host.querySelectorAll("[data-mask]")).toHaveLength(0)
  })

  it("says the image cannot load when its bytes could not be fetched", () => {
    asset.failed = true
    render(occlusionCard(), false, false, {}, false)
    expect(host.querySelector("img")).toBeNull()
    expect(host.textContent).toContain("StudyOcclusionImageFailed")
  })

  it("styles covered, asked and answer masks differently", () => {
    render(occlusionCard({}, ["m4"]), false, false)
    const style = (id: string) => host.querySelector(`[data-mask="${id}"]`)!.getAttribute("style")!

    expect(style("m1")).toContain("background: var(--mask)")
    expect(style("m1")).toContain("inset 0 0 0 1px var(--mask-edge)")
    expect(style("m2")).toContain("border-radius: 50%")
    expect(style("m4")).toContain("background: var(--accent-paper-asked)")
    expect(style("m4")).toContain("inset 0 0 0 2px var(--paper-ink), 0 0 0 2px var(--paper)")
    expect(style("m4")).toContain("color: var(--paper-fg)")
    expect(style("m4")).toContain("font-weight: 600")
    // 5% of a zero-height frame is below the floor, so the glyph is the minimum size.
    expect(style("m4")).toContain("font-size: 9px")
    expect(style("m4")).toContain("transition-duration: var(--duration-reveal)")
    expect(style("m1")).toContain("transition-duration: var(--duration-conceal)")

    render(occlusionCard(), true, true)
    expect(style("m4")).toContain("0 0 0 1px var(--paper), 0 0 0 3px var(--accent-paper)")
    expect(style("m4")).toContain("background: transparent")
    expect(style("m1")).toContain("color-mix(in srgb, var(--mask) 25%, transparent)")
    expect(style("m1")).toContain("inset 0 0 0 1px var(--paper-line)")
  })
})
