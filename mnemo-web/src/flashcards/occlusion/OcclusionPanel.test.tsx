// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { CardDto, OcclusionDto } from "@/api/types"

import { OcclusionPanel } from "./OcclusionPanel"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const measure = vi.hoisted(() => ({ chrome: 200, width: 600 }))

vi.mock("@/i18n/useT", () => ({ useT: () => (_ns: string, key: string) => key }))
vi.mock("../editor/assets", () => ({ useCardAsset: () => ({ url: "blob:cell", failed: false }) }))
vi.mock("./hooks", () => ({
  useElementSize: () => ({ w: measure.width, h: 0 }),
  useColumnRoom: () => ({ w: 600, h: 900 }),
  useChrome: () => measure.chrome,
  useImageLoad: () => ({ natural: { w: 1000, h: 1000 }, failed: false, onLoad: () => {}, onError: () => {} }),
}))

const occlusion: OcclusionDto & { imageAssetId: string } = {
  mode: "hideAll",
  masks: [],
  askedIds: [],
  back: "",
  imageAssetId: "asset-1",
}
const card = { id: "c1", type: "occlusion", front: "", back: "" } as unknown as CardDto

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  measure.chrome = 200
  measure.width = 600
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const stageHeight = () => host.querySelector<HTMLElement>('[data-testid="occlusion-stage"]')!.style.height

describe("OcclusionPanel", () => {
  it("keeps the image the same size when a long typed answer makes the revealed card taller", () => {
    act(() => root.render(<OcclusionPanel card={card} occlusion={occlusion} revealed={false} />))
    const before = stageHeight()

    measure.chrome = 700
    act(() => root.render(<OcclusionPanel card={card} occlusion={occlusion} revealed />))
    expect(stageHeight()).toBe(before)
  })

  it("follows a resize made after the reveal", () => {
    act(() => root.render(<OcclusionPanel card={card} occlusion={occlusion} revealed={false} />))
    act(() => root.render(<OcclusionPanel card={card} occlusion={occlusion} revealed />))

    measure.width = 400
    measure.chrome = 700
    act(() => root.render(<OcclusionPanel card={card} occlusion={occlusion} revealed />))
    const narrow = stageHeight()
    measure.chrome = 200
    act(() => root.render(<OcclusionPanel card={card} occlusion={occlusion} revealed />))

    expect(parseFloat(stageHeight())).toBeGreaterThan(parseFloat(narrow))
  })

  it("lets the image grow back once the front's chrome shrinks", () => {
    measure.chrome = 700
    act(() => root.render(<OcclusionPanel card={card} occlusion={occlusion} revealed={false} />))
    const small = stageHeight()

    measure.chrome = 200
    act(() => root.render(<OcclusionPanel card={card} occlusion={occlusion} revealed={false} />))
    expect(parseFloat(stageHeight())).toBeGreaterThan(parseFloat(small))
  })
})
