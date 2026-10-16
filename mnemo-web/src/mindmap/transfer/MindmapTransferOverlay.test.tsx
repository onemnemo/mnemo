// @vitest-environment jsdom

/**
 * Exercises replacement consent through the overlay that owns the import call.
 */

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { MindmapTransferImportResultDto, MindmapTransferUploadDto } from "@/api/types"
import { chooseFiles, confirmButton, conflictTrigger, flush, pickPolicy } from "@/components/transfer/dialog-test-kit"

import { toast } from "@/stores/toast"

import { MindmapTransferOverlay } from "./MindmapTransferOverlay"
import { useMindmapTransfer } from "./store"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const api = vi.hoisted(() => {
  function packageUpload(fileName: string): MindmapTransferUploadDto {
    return {
      uploadId: `upload-${fileName}`,
      fileName,
      sizeBytes: 2048,
      formatId: "mindmaps.mnemo",
      formatName: "Mnemo Package (.mnemo)",
      canImport: true,
      mapCount: 1,
      warnings: [],
      evidence: {
        kind: "export",
        collectionId: null,
        fromThisCollection: true,
        createdAtUtc: null,
        createdByAppVersion: null,
        canRead: true,
        payloads: [
          {
            payloadType: "mindmaps",
            payloadVersion: 2,
            supportedPayloadVersion: 2,
            canRead: true,
            inPackage: 1,
            alreadyHere: fileName.startsWith("Fresh") ? 0 : 1,
            newHere: 0,
            missingFromPackage: 0,
            replaceWouldDiscard: 0,
          },
        ],
      },
    }
  }

  return {
    runMindmapImport: vi.fn(),
    uploadMindmapTransferFile: vi.fn((file: File) => Promise.resolve(packageUpload(file.name))),
  }
})

// Keep query keys real while replacing the hook that needs a provider.
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock("./api", () => ({
  useMindmapTransferFormatsQuery: () => ({
    data: [
      {
        formatId: "mindmaps.mnemo",
        displayName: "Mnemo Package (.mnemo)",
        extensions: [".mnemo"],
        supportsImport: true,
        supportsExport: true,
      },
    ],
    isSuccess: true,
    isError: false,
  }),
  discardMindmapUpload: vi.fn(),
  runMindmapExport: vi.fn(),
  runMindmapImport: api.runMindmapImport,
  uploadMindmapTransferFile: api.uploadMindmapTransferFile,
}))

vi.mock("@/i18n/useT", () => ({
  useT: () => (_ns: string, key: string) => key,
}))

vi.mock("@/stores/toast", () => ({
  toast: { warning: vi.fn(), info: vi.fn(), success: vi.fn() },
}))

let container: HTMLElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  api.runMindmapImport.mockResolvedValue({
    succeededFiles: 1,
    failedFiles: 0,
    importedMaps: 1,
    warnings: [],
    errors: [],
  } satisfies MindmapTransferImportResultDto)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  act(() => useMindmapTransfer.getState().close())
})

function mount(node: ReactNode): void {
  act(() => root.render(node))
}

function openImportDialog(): void {
  act(() => useMindmapTransfer.getState().open({ direction: "import", scope: null }))
  mount(<MindmapTransferOverlay />)
}

describe("the mindmap transfer overlay's conflict choice", () => {
  it("asks nothing while nothing collides and keeps both", async () => {
    openImportDialog()
    await chooseFiles("Fresh.mnemo")

    expect(conflictTrigger()).toBeNull()
    act(() => confirmButton().click())
    await flush()

    expect(api.runMindmapImport).toHaveBeenCalledWith({
      uploadIds: ["upload-Fresh.mnemo"],
      conflictPolicy: "KeepBoth",
      targetFolderId: null,
    })
  })

  it("names the count on a red button once Replace is picked, and imports once", async () => {
    openImportDialog()
    await chooseFiles("Study.mnemo")
    expect(document.body.textContent).toContain("TransferConflictLabel")

    pickPolicy("TransferConflictReplace")
    expect(confirmButton().textContent).toContain("TransferReplaceCount")

    act(() => confirmButton().click())
    await flush()

    expect(api.runMindmapImport).toHaveBeenCalledTimes(1)
    expect(api.runMindmapImport).toHaveBeenCalledWith({
      uploadIds: ["upload-Study.mnemo"],
      conflictPolicy: "Replace",
      targetFolderId: null,
    })
  })

  it("takes Replace back when the queue changes", async () => {
    openImportDialog()
    await chooseFiles("Study.mnemo")
    pickPolicy("TransferConflictReplace")

    await chooseFiles("Fresh-b.mnemo")

    expect(confirmButton().textContent).not.toContain("TransferReplaceCount")
    act(() => confirmButton().click())
    await flush()
    expect(api.runMindmapImport.mock.calls[0][0]).toMatchObject({ conflictPolicy: "KeepBoth" })
  })

  it("imports into the folder it was opened on and says where the maps go", async () => {
    act(() =>
      useMindmapTransfer.getState().open({
        direction: "import",
        scope: null,
        destination: { folderId: "f-bio", label: "Biology" },
      }),
    )
    mount(<MindmapTransferOverlay />)

    await chooseFiles("Fresh.mnemo")
    expect(document.body.textContent).toContain("TransferToFormat")

    act(() => confirmButton().click())
    await flush()

    expect(api.runMindmapImport).toHaveBeenCalledWith({
      uploadIds: ["upload-Fresh.mnemo"],
      conflictPolicy: "KeepBoth",
      targetFolderId: "f-bio",
    })
  })
})

describe("the mindmap transfer overlay's post-import warnings", () => {
  // Only a .mnemo package's import adapter ever attaches a post-import warning; the
  // mocked format list here is already .mnemo-only, matching that.
  it("folds a warning into the completion toast and flips it to a warning tone", async () => {
    openImportDialog()
    await chooseFiles("Study.mnemo")
    api.runMindmapImport.mockResolvedValueOnce({
      succeededFiles: 1,
      failedFiles: 0,
      importedMaps: 2,
      warnings: [{ key: "PackageFolderRestoredAtRoot", params: {} }],
      errors: [],
    } satisfies MindmapTransferImportResultDto)

    act(() => confirmButton().click())
    await flush()

    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.warning).toHaveBeenCalledWith(
      "ImportCompleteTitle",
      expect.objectContaining({ description: expect.stringContaining("PackageFolderRestoredAtRoot") }),
    )
  })

  it("keeps the success tone when every line is information", async () => {
    openImportDialog()
    await chooseFiles("Study.mnemo")
    api.runMindmapImport.mockResolvedValueOnce({
      succeededFiles: 1,
      failedFiles: 0,
      importedMaps: 2,
      warnings: [{ key: "PackageFolderRestoredAtRoot", params: {}, severity: "info" }],
      errors: [],
    } satisfies MindmapTransferImportResultDto)

    act(() => confirmButton().click())
    await flush()

    expect(toast.warning).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith(
      "ImportCompleteTitle",
      expect.objectContaining({ description: expect.stringContaining("PackageFolderRestoredAtRoot") }),
    )
  })

  it("still reports plain success when the result carries no warnings", async () => {
    openImportDialog()
    await chooseFiles("Study.mnemo")

    act(() => confirmButton().click())
    await flush()

    expect(toast.success).toHaveBeenCalledWith("ImportCompleteTitle", expect.anything())
    expect(toast.warning).not.toHaveBeenCalled()
  })
})
