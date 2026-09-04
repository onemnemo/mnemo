// @vitest-environment jsdom

/**
 * Exercises replacement consent through the overlay that owns the import call.
 */

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { NoteTransferImportResultDto, NoteTransferUploadDto } from "@/api/types"

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
    runNoteImport: vi.fn(),
    uploadNoteTransferFile: vi.fn((file: File) => Promise.resolve(markdownUpload(file.name))),
  }
})

// Keep query keys real while replacing the hook that needs a provider.
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock("./api", () => ({
  useNoteTransferFormatsQuery: () => ({
    data: [
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
  runNoteExport: vi.fn(),
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
  act(() => root.render(node))
}

function openImportDialog(): void {
  act(() => useNoteTransfer.getState().open({ direction: "import", scope: null }))
  mount(<NoteTransferOverlay />)
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** Picks a file the way the hidden input reports one, since jsdom has no file chooser. */
async function chooseFile(name: string): Promise<void> {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement | null
  expect(input).not.toBeNull()
  const file = new File([new Uint8Array(1)], name)
  Object.defineProperty(input, "files", { value: [file], configurable: true })
  input?.dispatchEvent(new Event("change", { bubbles: true }))
  await flush()
}

function radioOption(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll('[role="radio"]')].find(
    (element) => element.textContent?.trim() === label,
  )
  expect(match).toBeDefined()
  return match as HTMLButtonElement
}

function consentCheckbox(): HTMLInputElement | null {
  return document.querySelector('input[type="checkbox"]')
}

/**
 * Find Confirm relative to Cancel because its icon and shortcut contribute text.
 */
function confirmButton(): HTMLButtonElement {
  const dialog = document.querySelector('[role="dialog"]')
  expect(dialog).not.toBeNull()
  const buttons = [...(dialog as HTMLElement).querySelectorAll("button")]
  const cancelIndex = buttons.findIndex((button) => button.textContent?.trim() === "Cancel")
  expect(cancelIndex).toBeGreaterThanOrEqual(0)
  return buttons[cancelIndex + 1]
}

// Click the checkbox so React's checked-value tracker observes the native toggle.
function setConsent(checked: boolean): void {
  const checkbox = consentCheckbox()
  expect(checkbox).not.toBeNull()
  if (!checkbox || checkbox.checked === checked) return
  act(() => {
    checkbox.click()
  })
}

describe("the note transfer overlay's replace consent", () => {
  it("keeps confirm disabled until consent is given, then imports with Replace exactly once", async () => {
    openImportDialog()

    await chooseFile("Biology.md")
    act(() => radioOption("TransferConflictReplace").click())

    expect(consentCheckbox()?.checked).toBe(false)
    expect(confirmButton().disabled).toBe(true)

    setConsent(true)
    expect(confirmButton().disabled).toBe(false)

    act(() => confirmButton().click())
    await flush()

    expect(api.runNoteImport).toHaveBeenCalledTimes(1)
    expect(api.runNoteImport).toHaveBeenCalledWith({
      uploadIds: ["upload-Biology.md"],
      conflictPolicy: "Replace",
    })
  })

  it("resets consent when the conflict policy changes", async () => {
    openImportDialog()

    await chooseFile("Biology.md")
    act(() => radioOption("TransferConflictReplace").click())
    setConsent(true)
    expect(confirmButton().disabled).toBe(false)

    act(() => radioOption("TransferConflictKeepBoth").click())
    act(() => radioOption("TransferConflictReplace").click())

    expect(consentCheckbox()?.checked).toBe(false)
    expect(confirmButton().disabled).toBe(true)
    expect(api.runNoteImport).not.toHaveBeenCalled()
  })

  it("resets consent when the queue changes", async () => {
    openImportDialog()

    await chooseFile("Biology.md")
    act(() => radioOption("TransferConflictReplace").click())
    setConsent(true)
    expect(confirmButton().disabled).toBe(false)

    await chooseFile("Chemistry.md")

    expect(consentCheckbox()?.checked).toBe(false)
    expect(confirmButton().disabled).toBe(true)
    expect(api.runNoteImport).not.toHaveBeenCalled()
  })
})

describe("the note transfer overlay's post-import warnings", () => {
  // Only a .mnemo package's import adapter ever attaches a post-import warning; a plain
  // markdown import never exercises this path. The result is shaped the way that adapter
  // reports one, regardless of which file the queue happens to hold.
  it("folds a warning into the completion toast and flips it to a warning tone", async () => {
    openImportDialog()
    await chooseFile("Notebook.md")
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

  it("still reports plain success when the result carries no warnings", async () => {
    openImportDialog()
    await chooseFile("Notebook.md")

    act(() => confirmButton().click())
    await flush()

    expect(toast.success).toHaveBeenCalledWith("ImportCompleteTitle", expect.anything())
    expect(toast.warning).not.toHaveBeenCalled()
  })
})
