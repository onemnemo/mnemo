// @vitest-environment jsdom

/**
 * Exercises consent through the dialog that owns the import call, including policy and queue
 * changes.
 */

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { TransferImportResultDto, TransferUploadDto } from "@/api/types"
import { chooseFiles, confirmButton, conflictTrigger, flush, pickPolicy } from "@/components/transfer/dialog-test-kit"

import type { TransferTarget } from "./store"
import { TransferDialog } from "./TransferDialog"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const api = vi.hoisted(() => {
  function packageUpload(fileName: string): TransferUploadDto {
    return {
      uploadId: `upload-${fileName}`,
      fileName,
      sizeBytes: 4096,
      formatId: "flashcards.mnemo",
      formatName: "Mnemo Package (.mnemo)",
      canImport: true,
      cardCount: null,
      warnings: [],
      evidence: {
        kind: "backup",
        collectionId: "collection-a",
        fromThisCollection: true,
        createdAtUtc: null,
        createdByAppVersion: null,
        canRead: true,
        payloads: [
          {
            payloadType: "flashcards",
            payloadVersion: 3,
            supportedPayloadVersion: 3,
            canRead: true,
            inPackage: 4,
            alreadyHere: fileName.startsWith("fresh") ? 0 : 3,
            newHere: 1,
            missingFromPackage: 2,
            replaceWouldDiscard: 17,
          },
        ],
      },
    }
  }

  return {
    runImport: vi.fn(),
    uploadTransferFile: vi.fn((file: File) => Promise.resolve(packageUpload(file.name))),
  }
})

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock("./api", () => ({
  useTransferFormatsQuery: () => ({
    data: [
      {
        formatId: "flashcards.mnemo",
        displayName: "Mnemo Package (.mnemo)",
        extensions: [".mnemo"],
        supportsImport: true,
        supportsExport: true,
        supportsConflictPolicy: true,
      },
    ],
    isSuccess: true,
    isError: false,
  }),
  discardUpload: vi.fn(),
  runExport: vi.fn(),
  runImport: api.runImport,
  uploadTransferFile: api.uploadTransferFile,
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
  api.runImport.mockResolvedValue({
    succeededFiles: 1,
    failedFiles: 0,
    importedCards: 5,
    warnings: [],
    errors: [],
  } satisfies TransferImportResultDto)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function mount(node: ReactNode): void {
  act(() => root.render(node))
}

function importTarget(): TransferTarget {
  return { direction: "import", scope: null }
}

describe("TransferDialog conflict choice", () => {
  it("asks nothing while nothing collides and keeps both", async () => {
    mount(<TransferDialog target={importTarget()} onClose={vi.fn()} />)
    await chooseFiles("fresh.mnemo")

    expect(conflictTrigger()).toBeNull()
    act(() => confirmButton().click())
    await flush()

    expect(api.runImport).toHaveBeenCalledWith({
      uploadIds: ["upload-fresh.mnemo"],
      conflictPolicy: "KeepBoth",
      targetFolderId: null,
    })
  })

  it("names the count on a red button once Replace is picked, and imports once", async () => {
    mount(<TransferDialog target={importTarget()} onClose={vi.fn()} />)
    await chooseFiles("collection.mnemo")
    expect(document.body.textContent).toContain("TransferConflictLabel")

    pickPolicy("TransferConflictReplace")
    expect(confirmButton().textContent).toContain("TransferReplaceCount")
    const note = [...document.querySelectorAll("p")].find((p) => p.textContent === "TransferEvidenceReplaceDiscardsFormat")
    expect(note?.className).toContain("leading-snug")
    expect(note?.className).not.toContain("truncate")

    act(() => confirmButton().click())
    await flush()

    expect(api.runImport).toHaveBeenCalledTimes(1)
    expect(api.runImport).toHaveBeenCalledWith({
      uploadIds: ["upload-collection.mnemo"],
      conflictPolicy: "Replace",
      targetFolderId: null,
    })
  })

  it("takes Replace back when the queue changes", async () => {
    mount(<TransferDialog target={importTarget()} onClose={vi.fn()} />)
    await chooseFiles("collection.mnemo")
    pickPolicy("TransferConflictReplace")

    await chooseFiles("fresh-b.mnemo")

    expect(confirmButton().textContent).not.toContain("TransferReplaceCount")
    act(() => confirmButton().click())
    await flush()
    expect(api.runImport.mock.calls[0][0]).toMatchObject({ conflictPolicy: "KeepBoth" })
  })

  it("imports into the folder it was opened on and says where the decks go", async () => {
    mount(
      <TransferDialog
        target={{ ...importTarget(), destination: { folderId: "f-bio", label: "Biology" } }}
        onClose={vi.fn()}
      />,
    )

    await chooseFiles("fresh.mnemo")
    expect(document.body.textContent).toContain("TransferToFormat")

    act(() => confirmButton().click())
    await flush()

    expect(api.runImport).toHaveBeenCalledWith({
      uploadIds: ["upload-fresh.mnemo"],
      conflictPolicy: "KeepBoth",
      targetFolderId: "f-bio",
    })
  })
})
