// @vitest-environment jsdom

/**
 * Exercises consent through the dialog that owns the import call, including policy and queue
 * changes.
 */

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { TransferImportResultDto, TransferUploadDto } from "@/api/types"

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
            alreadyHere: 3,
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

function importTarget(): TransferTarget {
  return { direction: "import", scope: null }
}

describe("TransferDialog replace consent", () => {
  it("keeps confirm disabled until consent is given, then imports with Replace exactly once", async () => {
    mount(<TransferDialog target={importTarget()} onClose={vi.fn()} />)

    await chooseFile("collection.mnemo")
    act(() => radioOption("TransferConflictReplace").click())

    expect(consentCheckbox()?.checked).toBe(false)
    expect(confirmButton().disabled).toBe(true)

    setConsent(true)
    expect(confirmButton().disabled).toBe(false)

    act(() => confirmButton().click())
    await flush()

    expect(api.runImport).toHaveBeenCalledTimes(1)
    expect(api.runImport).toHaveBeenCalledWith({
      uploadIds: ["upload-collection.mnemo"],
      conflictPolicy: "Replace",
    })
  })

  it("resets consent when the conflict policy changes", async () => {
    mount(<TransferDialog target={importTarget()} onClose={vi.fn()} />)

    await chooseFile("collection.mnemo")
    act(() => radioOption("TransferConflictReplace").click())
    setConsent(true)
    expect(confirmButton().disabled).toBe(false)

    act(() => radioOption("TransferConflictKeepBoth").click())
    act(() => radioOption("TransferConflictReplace").click())

    expect(consentCheckbox()?.checked).toBe(false)
    expect(confirmButton().disabled).toBe(true)
    expect(api.runImport).not.toHaveBeenCalled()
  })

  it("resets consent when the queue changes", async () => {
    mount(<TransferDialog target={importTarget()} onClose={vi.fn()} />)

    await chooseFile("collection-a.mnemo")
    act(() => radioOption("TransferConflictReplace").click())
    setConsent(true)
    expect(confirmButton().disabled).toBe(false)

    await chooseFile("collection-b.mnemo")

    expect(consentCheckbox()?.checked).toBe(false)
    expect(confirmButton().disabled).toBe(true)
    expect(api.runImport).not.toHaveBeenCalled()
  })
})
