// @vitest-environment jsdom

/**
 * Exercises replacement consent through the overlay that owns the import call.
 */

import { act, StrictMode, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { NoteSummaryDto, NoteTransferImportResultDto, NoteTransferUploadDto } from "@/api/types"
import { chooseFiles, confirmButton, conflictTrigger, flush, pickPolicy } from "@/components/transfer/dialog-test-kit"

import { toast } from "@/stores/toast"

import { NoteTransferOverlay } from "./NoteTransferOverlay"
import { useNoteTransfer } from "./store"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const api = vi.hoisted(() => {
  function markdownUpload(fileName: string): NoteTransferUploadDto {
    return {
      uploadId: `upload-${fileName}`,
      fileName,
      sizeBytes: 512,
      formatId: "notes.markdown",
      formatName: "Markdown (.md)",
      canImport: true,
      noteCount: 1,
      warnings: [],
    }
  }

  return {
    runNoteExport: vi.fn(),
    runNoteImport: vi.fn(),
    uploadNoteTransferFile: vi.fn((file: File) => Promise.resolve(markdownUpload(file.name))),
  }
})

// Keep query keys real while replacing the hook that needs a provider.
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

const library = vi.hoisted(() => ({ notes: [] as { title: string; folderId: null; parentNoteId: null }[] }))

vi.mock("@/notes/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/notes/api")>()),
  useNotesQuery: () => ({ data: library.notes as NoteSummaryDto[] }),
  useNoteFoldersQuery: () => ({ data: [] }),
}))

vi.mock("./api", () => ({
  useNoteTransferFormatsQuery: () => ({
    data: [
      {
        formatId: "notes.mnemo",
        displayName: "Mnemo Package (.mnemo)",
        extensions: [".mnemo"],
        supportsImport: true,
        supportsExport: true,
      },
      {
        formatId: "notes.markdown",
        displayName: "Markdown (.md)",
        extensions: [".md"],
        supportsImport: true,
        supportsExport: true,
      },
    ],
    isSuccess: true,
    isError: false,
  }),
  discardNoteUpload: vi.fn(),
  runNoteExport: api.runNoteExport,
  runNoteImport: api.runNoteImport,
  uploadNoteTransferFile: api.uploadNoteTransferFile,
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
  library.notes = [{ title: "Cells", folderId: null, parentNoteId: null }]
  api.runNoteImport.mockResolvedValue({
    succeededFiles: 1,
    failedFiles: 0,
    importedNotes: 1,
    warnings: [],
    errors: [],
  } satisfies NoteTransferImportResultDto)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  act(() => useNoteTransfer.getState().close())
})

function mount(node: ReactNode): void {
  act(() => root.render(<StrictMode>{node}</StrictMode>))
}

function openImportDialog(): void {
  act(() => useNoteTransfer.getState().open({ direction: "import", scope: null }))
  mount(<NoteTransferOverlay />)
}

describe("the note transfer overlay's conflict choice", () => {
  it("asks nothing while nothing collides and keeps both", async () => {
    openImportDialog()
    await chooseFiles("Tissue.md")

    expect(conflictTrigger()).toBeNull()
    act(() => confirmButton().click())
    await flush()

    expect(api.runNoteImport).toHaveBeenCalledWith({
      uploadIds: ["upload-Tissue.md"],
      conflictPolicy: "KeepBoth",
      targetFolderId: null,
    })
  })

  it("names the count on a red button once Replace is picked, and imports once", async () => {
    openImportDialog()
    await chooseFiles("cells.md")
    expect(document.body.textContent).toContain("TransferAlreadyExists")

    pickPolicy("TransferConflictReplace")
    expect(confirmButton().textContent).toContain("TransferReplaceCount")

    act(() => confirmButton().click())
    await flush()

    expect(api.runNoteImport).toHaveBeenCalledTimes(1)
    expect(api.runNoteImport).toHaveBeenCalledWith({
      uploadIds: ["upload-cells.md"],
      conflictPolicy: "Replace",
      targetFolderId: null,
    })
  })

  it("takes Replace back when the queue changes", async () => {
    openImportDialog()
    await chooseFiles("cells.md")
    pickPolicy("TransferConflictReplace")

    await chooseFiles("Organs.md")

    expect(confirmButton().textContent).not.toContain("TransferReplaceCount")
    act(() => confirmButton().click())
    await flush()
    expect(api.runNoteImport.mock.calls[0][0]).toMatchObject({ conflictPolicy: "KeepBoth" })
  })
})

describe("the note transfer overlay's replace reset", () => {
  it("goes back to Keep both once nothing collides any more", async () => {
    openImportDialog()
    await chooseFiles("cells.md")
    pickPolicy("TransferConflictReplace")
    expect(confirmButton().textContent).toContain("TransferReplaceCount")

    library.notes = []
    mount(<NoteTransferOverlay />)
    library.notes = [{ title: "Cells", folderId: null, parentNoteId: null }]
    mount(<NoteTransferOverlay />)

    expect(confirmButton().textContent).not.toContain("TransferReplaceCount")
  })
})

describe("the note transfer overlay's folder import", () => {
  it("sends each file's folder path beside its upload", async () => {
    openImportDialog()
    const input = document.querySelector<HTMLInputElement>("input[webkitdirectory]")
    expect(input).not.toBeNull()
    const file = new File(["x"], "Cells.md")
    Object.defineProperty(file, "webkitRelativePath", { value: "Vault/Biology/Cells.md" })
    Object.defineProperty(input, "files", { value: [file], configurable: true })
    input!.dispatchEvent(new Event("change", { bubbles: true }))
    await flush()
    await flush()

    act(() => confirmButton().click())
    await flush()

    expect(api.runNoteImport).toHaveBeenCalledWith({
      uploadIds: ["upload-Cells.md"],
      conflictPolicy: "KeepBoth",
      targetFolderId: null,
      folderPaths: { "upload-Cells.md": "Vault/Biology" },
    })
  })
})

describe("the note transfer overlay's import destination", () => {
  it("sends the folder the dialog was opened for", async () => {
    act(() =>
      useNoteTransfer.getState().open({
        direction: "import",
        scope: null,
        destination: { folderId: "folder-1", label: "Biology" },
      }),
    )
    mount(<NoteTransferOverlay />)

    await chooseFiles("Cells.md")
    act(() => confirmButton().click())
    await flush()

    expect(api.runNoteImport).toHaveBeenCalledWith({
      uploadIds: ["upload-Cells.md"],
      conflictPolicy: "KeepBoth",
      targetFolderId: "folder-1",
    })
  })

  it("names no folder when opened from the sidebar header, so the import lands at the root", async () => {
    openImportDialog()

    await chooseFiles("Cells.md")
    act(() => confirmButton().click())
    await flush()

    expect(api.runNoteImport).toHaveBeenCalledWith(expect.objectContaining({ targetFolderId: null }))
  })
})

describe("the note transfer overlay's folder export", () => {
  it("sends the folder whole and names the file after the folder, not its path", async () => {
    api.runNoteExport.mockResolvedValue({ status: "downloaded" })
    act(() =>
      useNoteTransfer.getState().open({
        direction: "export",
        scope: { label: "Medicine / Anatomy", fileName: "Anatomy", noteIds: ["n1"], folderIds: ["f1"] },
      }),
    )
    mount(<NoteTransferOverlay />)
    await flush()

    act(() => confirmButton().click())
    await flush()

    expect(api.runNoteExport).toHaveBeenCalledWith(
      { formatId: "notes.mnemo", noteIds: ["n1"], folderIds: ["f1"] },
      expect.objectContaining({ fileName: "Anatomy.mnemo" }),
    )
  })
})

describe("the note transfer overlay's post-import warnings", () => {
  // Only a .mnemo package's import adapter ever attaches a post-import warning; a plain
  // markdown import never exercises this path. The result is shaped the way that adapter
  // reports one, regardless of which file the queue happens to hold.
  it("folds a warning into the completion toast and flips it to a warning tone", async () => {
    openImportDialog()
    await chooseFiles("Notebook.md")
    api.runNoteImport.mockResolvedValueOnce({
      succeededFiles: 1,
      failedFiles: 0,
      importedNotes: 3,
      warnings: [{ key: "PackageFolderRestoredAtRoot", params: {} }],
      errors: [],
    } satisfies NoteTransferImportResultDto)

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
    await chooseFiles("Notebook.md")
    api.runNoteImport.mockResolvedValueOnce({
      succeededFiles: 1,
      failedFiles: 0,
      importedNotes: 3,
      warnings: [{ key: "PackageFolderRestoredAtRoot", params: {}, severity: "info" }],
      errors: [],
    } satisfies NoteTransferImportResultDto)

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
    await chooseFiles("Notebook.md")

    act(() => confirmButton().click())
    await flush()

    expect(toast.success).toHaveBeenCalledWith("ImportCompleteTitle", expect.anything())
    expect(toast.warning).not.toHaveBeenCalled()
  })
})
