// @vitest-environment jsdom

/**
 * What the export side of the dialog is allowed to claim. The toast is the only thing that tells
 * anyone whether a file exists, so it has to follow the outcome the save actually reported rather
 * than the fact that the call returned.
 */

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { toast } from "@/stores/toast"

import { runExport } from "./api"
import { TransferDialog } from "./TransferDialog"
import type { TransferTarget } from "./store"

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock("./api", () => ({
  useTransferFormatsQuery: () => ({
    data: [
      {
        formatId: "mnemo",
        displayName: "Package",
        extensions: [".mnemo"],
        supportsExport: true,
        supportsImport: true,
      },
    ],
    isSuccess: true,
    isError: false,
    error: null,
  }),
  discardUpload: vi.fn(),
  runExport: vi.fn(),
  runImport: vi.fn(),
  uploadTransferFile: vi.fn(),
}))

vi.mock("@/i18n/useT", () => ({
  useT: () => (_ns: string, key: string) => key,
}))

vi.mock("@/stores/toast", () => ({
  toast: { warning: vi.fn(), info: vi.fn(), success: vi.fn() },
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const target: TransferTarget = {
  direction: "export",
  scope: { deckIds: ["deck-1"], label: "Deck one", wholeCollection: false },
}

let container: HTMLElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
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

/** The footer's primary button, which is the one labelled with the format it would write. */
function confirmButton(): HTMLButtonElement {
  const buttons = Array.from(document.querySelectorAll("button"))
  const found = buttons.find((button) => button.textContent?.includes("TransferExportButtonFormat"))
  if (!found) throw new Error("The export button is not on screen.")
  return found as HTMLButtonElement
}

async function clickExport(onClose: () => void = vi.fn()): Promise<void> {
  mount(<TransferDialog target={target} onClose={onClose} />)
  await act(async () => {
    confirmButton().click()
    await Promise.resolve()
  })
}

describe("TransferDialog export reporting", () => {
  it("stays put and says nothing when the save was cancelled", async () => {
    vi.mocked(runExport).mockResolvedValue({ status: "cancelled" })
    const onClose = vi.fn()

    await clickExport(onClose)

    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.warning).not.toHaveBeenCalled()
    // What the cancel branch uniquely produces: the dialog is still open on the same choices, with
    // the button live again. Asserting only the absent toast would pass on a run that never got
    // as far as the export at all.
    expect(onClose).not.toHaveBeenCalled()
    expect(confirmButton().disabled).toBe(false)
  })

  it("names the file the host wrote", async () => {
    vi.mocked(runExport).mockResolvedValue({ status: "saved", path: "/home/me/Documents/Deck one.mnemo" })

    await clickExport()

    expect(toast.success).toHaveBeenCalledWith(
      "ExportCompleteTitle",
      expect.objectContaining({ description: "/home/me/Documents/Deck one.mnemo" }),
    )
  })

  it("reports a failure with the reason it was given", async () => {
    vi.mocked(runExport).mockRejectedValue(new Error("That folder is read only."))

    await clickExport()

    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.warning).toHaveBeenCalledWith(
      "ExportFailedTitle",
      expect.objectContaining({ description: "That folder is read only." }),
    )
  })
})
