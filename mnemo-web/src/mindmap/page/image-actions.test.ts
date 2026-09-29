// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest"

import type { MindmapEditor } from "../edit/useMindmapEditor"
import type { MindmapDocument } from "../model/document"
import type { MindmapOp } from "../model/ops"
import { estimateWidth, measurersFrom } from "../scene/measure"
import { projectScene } from "../scene/project"

import { runImageAction, type ImageActionHost } from "./image-actions"

const mocks = vi.hoisted(() => ({
  editImage: vi.fn(),
  blobUrl: vi.fn(),
  upload: vi.fn(),
  measure: vi.fn(),
  warning: vi.fn(),
}))

vi.mock("@/components/ui/image-editor/store", () => ({ editImage: mocks.editImage }))
vi.mock("@/api/asset-blob", () => ({ fetchAssetBlobUrl: mocks.blobUrl, fetchAssetBlob: vi.fn() }))
vi.mock("@/stores/toast", () => ({ toast: { warning: mocks.warning } }))
vi.mock("../assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../assets")>()),
  uploadMindmapImage: mocks.upload,
  measureImageFile: mocks.measure,
}))

const CROP = { x: 0.25, y: 0, w: 0.5, h: 1, aspect: 2 }

function host(crop?: typeof CROP): { host: ImageActionHost; applied: MindmapOp[][] } {
  const document: MindmapDocument = {
    id: "m",
    elements: [
      {
        id: "pic",
        kind: "image",
        content: crop ? { $type: "canvasImage", assetId: "a.png", crop } : { $type: "canvasImage", assetId: "a.png" },
        x: 100,
        y: 100,
        width: 200,
        height: 200,
      },
    ],
  }
  const scene = projectScene(document, { templates: [], defaultTemplateId: "", measurers: measurersFrom(estimateWidth) })
  const applied: MindmapOp[][] = []
  const editor = {
    apply: vi.fn(async (ops: MindmapOp[]) => {
      applied.push(ops)
      return {}
    }),
  } as unknown as MindmapEditor
  return { host: { editor, scene: () => scene, t: (_ns: string, key: string) => key }, applied }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.blobUrl.mockResolvedValue("blob:source")
  globalThis.URL.revokeObjectURL = vi.fn()
})

describe("crop and reposition", () => {
  it("stores the window and reshapes the box to it at the same width, in one edit", async () => {
    const { host: h, applied } = host()
    mocks.editImage.mockResolvedValue({ file: null, crop: CROP })

    await runImageAction(h, "pic", "crop")

    expect(mocks.editImage).toHaveBeenCalledWith(expect.objectContaining({ src: "blob:source", crop: null }))
    expect(applied).toEqual([
      [
        { op: "set", id: "pic", content: { $type: "canvasImage", assetId: "a.png", crop: CROP }, wh: [200, 100] },
        { op: "move", id: "pic", xy: [100, 150], pin: false },
      ],
    ])
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:source")
  })

  it("reopens on the stored window and spends nothing when it comes back unchanged", async () => {
    const { host: h, applied } = host(CROP)
    mocks.editImage.mockResolvedValue({ file: null, crop: { ...CROP } })

    await runImageAction(h, "pic", "crop")

    expect(mocks.editImage).toHaveBeenCalledWith(expect.objectContaining({ crop: CROP }))
    expect(applied).toEqual([])
  })

  it("drops the crop when the whole picture is framed again", async () => {
    const { host: h, applied } = host(CROP)
    mocks.editImage.mockResolvedValue({ file: null, crop: { x: 0, y: 0, w: 1, h: 1, aspect: 1 } })

    await runImageAction(h, "pic", "crop")

    expect(applied[0][0]).toEqual({ op: "set", id: "pic", content: { $type: "canvasImage", assetId: "a.png" }, wh: [200, 200] })
  })

  it("does nothing when the dialog is cancelled", async () => {
    const { host: h, applied } = host()
    mocks.editImage.mockResolvedValue(null)

    await runImageAction(h, "pic", "crop")

    expect(applied).toEqual([])
  })
})

describe("replace", () => {
  it("uploads the new picture and fits the box to it about the same centre", async () => {
    const { host: h, applied } = host(CROP)
    mocks.editImage.mockResolvedValue({ file: new File(["x"], "b.png", { type: "image/png" }), crop: { x: 0, y: 0, w: 1, h: 1, aspect: 1.5 } })
    mocks.upload.mockResolvedValue({ assetId: "b.png", sizeBytes: 1 })
    mocks.measure.mockResolvedValue([300, 200])

    await runImageAction(h, "pic", "replace")

    expect(applied).toEqual([
      [
        { op: "set", id: "pic", content: { $type: "canvasImage", assetId: "b.png" }, wh: [300, 200] },
        { op: "move", id: "pic", xy: [50, 100], pin: false },
      ],
    ])
  })
})
