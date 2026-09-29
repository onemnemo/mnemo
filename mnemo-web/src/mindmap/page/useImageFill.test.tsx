// @vitest-environment jsdom

import { act, type DragEvent, type ClipboardEvent } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { imageSlotOf } from "../canvas/image-slots"
import type { CanvasRuntime } from "../canvas/runtime"
import type { MindmapEditor } from "../edit/useMindmapEditor"
import { EMPTY_SELECTION, selectOnly, type Selection } from "../interaction/selection"
import type { MindmapDocument } from "../model/document"
import type { MindmapOp } from "../model/ops"
import type { Scene } from "../model/scene"
import { estimateWidth, measurersFrom } from "../scene/measure"
import { projectScene } from "../scene/project"

import { useImageFill } from "./useImageFill"

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  measure: vi.fn(),
  warning: vi.fn(),
}))

vi.mock("../assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../assets")>()),
  uploadMindmapImage: mocks.upload,
  measureImageFile: mocks.measure,
}))

vi.mock("@/i18n/useT", () => ({
  useT: () => (_ns: string, key: string) => key,
}))

vi.mock("@/stores/toast", () => ({
  toast: { warning: mocks.warning, info: vi.fn() },
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DOCUMENT: MindmapDocument = {
  id: "m",
  elements: [
    { id: "slot", kind: "image", content: { $type: "canvasImage", assetId: "" }, x: 100, y: 100, width: 240, height: 160 },
  ],
}

const SCENE: Scene = projectScene(DOCUMENT, {
  templates: [],
  defaultTemplateId: "",
  measurers: measurersFrom(estimateWidth),
})

let root: Root
let host: HTMLDivElement
let applied: MindmapOp[][]
let fill: ReturnType<typeof useImageFill>

function png(name: string): File {
  return new File(["x"], name, { type: "image/png" })
}

const editor = {
  apply: vi.fn(async (ops: MindmapOp[]) => {
    applied.push(ops)
    return { createdIds: { n: `new${applied.length}` } }
  }),
} as unknown as MindmapEditor

// Canvas and client coordinates are the same thing here.
const runtime = { current: { toCanvas: (x: number, y: number) => ({ x, y }) } as unknown as CanvasRuntime }

let shown: { scene: Scene | null; selection: Selection } = { scene: null, selection: EMPTY_SELECTION }

function Probe() {
  fill = useImageFill({
    mapId: "m",
    editor,
    scene: shown.scene,
    selection: shown.selection,
    setSelection: () => {},
    runtime,
    viewportCentre: () => ({ x: 0, y: 0 }),
  })
  return fill.picker
}

/** Renders, or re-renders the same hook with a new scene, the way the route does after an edit. */
function mount(scene: Scene | null, selection: Selection = EMPTY_SELECTION): void {
  shown = { scene, selection }
  act(() => root.render(<Probe />))
}

function drop(files: File[], at: { x: number; y: number }, data: Record<string, string> = {}): void {
  const event = {
    clientX: at.x,
    clientY: at.y,
    preventDefault: vi.fn(),
    dataTransfer: {
      types: files.length > 0 ? ["Files"] : Object.keys(data),
      files,
      getData: (type: string) => data[type] ?? "",
    },
  } as unknown as DragEvent
  fill.onDrop(event)
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
  })
}

beforeEach(() => {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  applied = []
  let asset = 0
  mocks.upload.mockImplementation(async () => ({ assetId: `asset${(asset += 1)}.png`, sizeBytes: 1 }))
  mocks.measure.mockResolvedValue([300, 100])
  mocks.warning.mockReset()
  mocks.upload.mockClear()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe("filling an empty image", () => {
  it("fills the placeholder a file is dropped on, as one edit that keeps its centre", async () => {
    mount(SCENE)
    drop([png("a.png")], { x: 150, y: 150 })
    await settle()

    expect(applied).toEqual([
      [
        { op: "set", id: "slot", content: { $type: "canvasImage", assetId: "asset1.png" }, wh: [300, 100] },
        { op: "move", id: "slot", xy: [70, 130], pin: false },
      ],
    ])
    expect(imageSlotOf("m", "slot")).toBe("idle")
  })

  it("places the files after the first beside the filled picture", async () => {
    mount(SCENE)
    drop([png("a.png"), png("b.png")], { x: 150, y: 150 })
    await settle()

    expect(applied).toHaveLength(2)
    expect(applied[1]).toEqual([
      {
        op: "add_el",
        kind: "image",
        xy: [386, 130],
        content: { $type: "canvasImage", assetId: "asset2.png" },
        ref: "n",
        wh: [300, 100],
      },
    ])
  })

  it("places a new picture where a drop misses every placeholder", async () => {
    mount(SCENE)
    drop([png("a.png")], { x: 900, y: 900 })
    await settle()

    expect(applied).toHaveLength(1)
    expect(applied[0][0]).toMatchObject({ op: "add_el", xy: [750, 850] })
  })

  it("fills the selected placeholder from a paste", async () => {
    mount(SCENE, selectOnly("element", "slot"))
    const event = {
      target: document.body,
      preventDefault: vi.fn(),
      clipboardData: { files: [png("a.png")] },
    } as unknown as ClipboardEvent
    fill.onPaste(event)
    await settle()

    expect(applied).toHaveLength(1)
    expect(applied[0][0]).toMatchObject({ op: "set", id: "slot" })
  })

  it("writes nothing and shows the failure when the upload fails", async () => {
    mocks.upload.mockRejectedValueOnce(new Error("too big"))
    mount(SCENE)
    drop([png("a.png")], { x: 150, y: 150 })
    await settle()

    expect(applied).toHaveLength(0)
    expect(imageSlotOf("m", "slot")).toBe("failed")
    expect(mocks.warning).toHaveBeenCalledOnce()
  })

  it("places none of the other files when the fill fails, and says so once", async () => {
    mocks.upload.mockRejectedValueOnce(new Error("too big"))
    mount(SCENE)
    drop([png("a.png"), png("b.png"), png("c.png")], { x: 150, y: 150 })
    await settle()

    expect(applied).toHaveLength(0)
    expect(mocks.warning).toHaveBeenCalledOnce()
  })

  it("ignores a second drop on a placeholder that is still uploading", async () => {
    let arrive: (asset: { assetId: string; sizeBytes: number }) => void = () => {}
    mocks.upload.mockImplementationOnce(() => new Promise((resolve) => (arrive = resolve)))
    mount(SCENE)
    drop([png("a.png")], { x: 150, y: 150 })
    expect(imageSlotOf("m", "slot")).toBe("uploading")
    drop([png("b.png")], { x: 150, y: 150 })
    await settle()
    arrive({ assetId: "first.png", sizeBytes: 1 })
    await settle()

    expect(mocks.upload).toHaveBeenCalledOnce()
    expect(applied).toHaveLength(1)
  })

  it("forgets a failed upload once its placeholder is gone", async () => {
    mocks.upload.mockRejectedValueOnce(new Error("too big"))
    mount(SCENE)
    drop([png("a.png")], { x: 150, y: 150 })
    await settle()
    expect(imageSlotOf("m", "slot")).toBe("failed")

    mount({ ...SCENE, elements: [] })
    expect(imageSlotOf("m", "slot")).toBe("idle")
  })

  it("drops the fill quietly when the placeholder went away during the upload", async () => {
    let arrive: (asset: { assetId: string; sizeBytes: number }) => void = () => {}
    mocks.upload.mockImplementationOnce(() => new Promise((resolve) => (arrive = resolve)))
    mount(SCENE)
    drop([png("a.png")], { x: 150, y: 150 })
    await settle()
    mount({ ...SCENE, elements: [] })
    arrive({ assetId: "late.png", sizeBytes: 1 })
    await settle()

    expect(applied).toHaveLength(0)
    expect(mocks.warning).not.toHaveBeenCalled()
  })

  it("says why when a picture dragged from a page cannot be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("cors"))))
    mount(SCENE)
    drop([], { x: 150, y: 150 }, { "text/uri-list": "https://cdn.test/cat.png" })
    await settle()
    vi.unstubAllGlobals()

    expect(applied).toHaveLength(0)
    expect(mocks.warning).toHaveBeenCalledWith("ImageDropFromPage")
  })
})
