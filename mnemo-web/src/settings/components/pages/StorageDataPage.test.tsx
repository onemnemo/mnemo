// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/api/client"

const mocks = vi.hoisted(() => ({
  allowNextControlledShutdown: vi.fn(),
  announceExport: vi.fn(),
  cancelControlledShutdown: vi.fn(),
  chooseExportTarget: vi.fn(),
  confirm: vi.fn(),
  consumeRestoreStatus: vi.fn(),
  getBackupRestoreState: vi.fn(),
  openHostFolder: vi.fn(),
  progress: vi.fn(),
  requestBackupExport: vi.fn(),
  restartForBackupRestore: vi.fn(),
  saveServerExport: vi.fn(),
  selectBackup: vi.fn(),
  stageBackupRestore: vi.fn(),
  success: vi.fn(),
  update: vi.fn(),
  waitForControlledShutdownStart: vi.fn(),
  warning: vi.fn(),
}))

vi.mock("@/api/export-file", () => ({
  announceExport: mocks.announceExport,
  chooseExportTarget: mocks.chooseExportTarget,
  exportSaveOptions: () => ({ dialogTitle: "SaveBackup", overwrite: {} }),
  saveServerExport: mocks.saveServerExport,
}))
vi.mock("@/app/shutdown", () => ({
  allowNextControlledShutdown: mocks.allowNextControlledShutdown,
  cancelControlledShutdown: mocks.cancelControlledShutdown,
  waitForControlledShutdownStart: mocks.waitForControlledShutdownStart,
}))
vi.mock("@/components/icon/AppIcon", () => ({ AppIcon: () => null }))
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}))
vi.mock("@/components/ui/modal", () => ({
  Modal: ({ open, title, children, footer }: React.PropsWithChildren<{ open: boolean; title: string; footer: React.ReactNode }>) =>
    open ? (
      <div role="dialog" aria-label={title}>
        {children}
        {footer}
      </div>
    ) : null,
}))
vi.mock("@/i18n/useT", () => ({
  useT: () => (_namespace: string, key: string, values?: Record<string, unknown>) =>
    values?.folder ? `${key}:${String(values.folder)}` : key,
}))
vi.mock("@/i18n/store", () => ({
  useI18nStore: (selector: (state: { language: string }) => unknown) => selector({ language: "en" }),
}))
vi.mock("@/stores/dialog", () => ({ dialog: { confirm: mocks.confirm } }))
vi.mock("@/stores/toast", () => ({
  toast: { progress: mocks.progress, success: mocks.success, update: mocks.update, warning: mocks.warning },
}))
vi.mock("../../backup-api", () => ({
  consumeRestoreStatus: mocks.consumeRestoreStatus,
  getBackupRestoreState: mocks.getBackupRestoreState,
  requestBackupExport: mocks.requestBackupExport,
  restartForBackupRestore: mocks.restartForBackupRestore,
  selectBackup: mocks.selectBackup,
  stageBackupRestore: mocks.stageBackupRestore,
}))
vi.mock("../../folders", () => ({ openHostFolder: mocks.openHostFolder }))

// The real command, wrapped so a test can see that the page reaches it rather than a copy.
const shared = vi.hoisted(() => ({ createProfileBackup: vi.fn() }))
vi.mock("../../backup-export", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../backup-export")>()
  shared.createProfileBackup.mockImplementation(actual.createProfileBackup)
  return { ...actual, createProfileBackup: shared.createProfileBackup }
})

import { StorageDataPage } from "./StorageDataPage"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const inspection = {
  createdAtUtc: "2026-09-11T12:00:00Z",
  createdByAppVersion: "0.8.0-beta",
  fromThisCollection: true,
  contents: {
    notes: 2,
    noteFolders: 1,
    flashcardDecks: 1,
    flashcardCards: 4,
    flashcardTestAttempts: 3,
    mindmaps: 5,
    mindmapFolders: 1,
    trashEntries: 7,
    conversations: 8,
    managedFiles: 9,
    portableSettings: 10,
  },
}

const chosenTarget = { status: "chosen", grant: "export-grant", path: "C:\\Backups\\mnemo.mnemo-backup" }

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  mocks.chooseExportTarget.mockResolvedValue(chosenTarget)
  mocks.progress.mockReturnValue("backup-progress")
  mocks.saveServerExport.mockResolvedValue({ status: "saved", path: chosenTarget.path })
  mocks.selectBackup.mockResolvedValue({ available: true, cancelled: false, grant: "restore-grant", inspection })
  mocks.confirm.mockResolvedValue(true)
  mocks.consumeRestoreStatus.mockResolvedValue(null)
  mocks.getBackupRestoreState.mockResolvedValue({ staged: true, restartRequested: false })
  mocks.waitForControlledShutdownStart.mockResolvedValue(false)
  mocks.stageBackupRestore.mockResolvedValue({ operationId: "a".repeat(32) })
  mocks.restartForBackupRestore.mockResolvedValue(undefined)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

async function renderPage() {
  await act(async () => {
    root.render(<StorageDataPage />)
    await Promise.resolve()
  })
}

async function press(label: string, occurrence = 0) {
  const button = [...container.querySelectorAll("button")].filter((item) => item.textContent === label)[occurrence]
  expect(button).toBeDefined()
  await act(async () => {
    button.click()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe("StorageDataPage", () => {
  it("saves to the concrete target selected by the host", async () => {
    await renderPage()
    await press("BackUp")

    expect(shared.createProfileBackup).toHaveBeenCalledOnce()
    expect(mocks.saveServerExport).toHaveBeenCalledWith(expect.any(Object), expect.any(Function), chosenTarget)
    expect(mocks.progress).toHaveBeenCalledWith("BackingUp", {
      description: expect.stringMatching(/^BackupFileName\.mnemo-backup$/),
    })
    expect(mocks.announceExport).toHaveBeenCalledWith(
      { status: "saved", path: chosenTarget.path },
      expect.objectContaining({ title: "BackupComplete" }),
      "backup-progress",
    )
  })

  it("turns backup progress into the failure instead of leaving conflicting toasts", async () => {
    mocks.saveServerExport.mockRejectedValue(new ApiError("failed", 409, "backup_failed"))
    await renderPage()

    await press("BackUp")

    expect(mocks.update).toHaveBeenCalledWith("backup-progress", {
      type: "warning",
      title: "BackupFailed",
      description: expect.any(String),
    })
    expect(mocks.warning).not.toHaveBeenCalledWith("BackupFailed", expect.anything())
  })

  it("previews the actual selection response before offering restore", async () => {
    await renderPage()
    await press("ChooseBackup")

    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    expect(container.textContent).toContain("0.8.0-beta")
    expect(container.textContent).toContain("BackupThisCollection")
    for (const count of [3, 5, 6, 7, 8, 9]) expect(container.textContent).toContain(String(count))
    expect(mocks.stageBackupRestore).not.toHaveBeenCalled()
  })

  it("stages the restore before permitting the controlled restart", async () => {
    const order: string[] = []
    mocks.stageBackupRestore.mockImplementation(async () => {
      order.push("stage")
      return { operationId: "a".repeat(32) }
    })
    mocks.allowNextControlledShutdown.mockImplementation(() => order.push("allow"))
    mocks.restartForBackupRestore.mockImplementation(async () => {
      order.push("restart")
    })
    await renderPage()
    await press("ChooseBackup")

    await press("RestoreBackup")

    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }))
    expect(order).toEqual(["stage", "allow", "restart"])
  })

  it("keeps the current data when destructive confirmation is declined", async () => {
    mocks.confirm.mockResolvedValue(false)
    await renderPage()
    await press("ChooseBackup")

    await press("RestoreBackup")

    expect(mocks.stageBackupRestore).not.toHaveBeenCalled()
    expect(mocks.allowNextControlledShutdown).not.toHaveBeenCalled()
  })

  it("keeps the staged restore when the host refuses to restart", async () => {
    mocks.restartForBackupRestore.mockRejectedValue(new ApiError("unavailable", 409, "restart_unavailable"))
    await renderPage()
    await press("ChooseBackup")

    await press("RestoreBackup")

    expect(mocks.cancelControlledShutdown).toHaveBeenCalledOnce()
    expect(mocks.warning).toHaveBeenCalledWith("RestoreFailed", { description: "RestartUnavailable" })
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it("keeps waiting when the host accepted a restart whose response was lost", async () => {
    mocks.restartForBackupRestore.mockRejectedValue(new TypeError("network closed"))
    mocks.getBackupRestoreState.mockResolvedValue({ staged: true, restartRequested: true })
    await renderPage()
    await press("ChooseBackup")

    await press("RestoreBackup")

    expect(mocks.getBackupRestoreState).toHaveBeenCalledWith("a".repeat(32))
    expect(mocks.cancelControlledShutdown).not.toHaveBeenCalled()
    expect(mocks.warning).not.toHaveBeenCalledWith("RestoreFailed", expect.anything())
    expect(container.textContent).toContain("PreparingRestore")
  })

  it("leaves a staged restore for the next launch when restart did not begin", async () => {
    mocks.restartForBackupRestore.mockRejectedValue(new TypeError("network failed"))
    await renderPage()
    await press("ChooseBackup")

    await press("RestoreBackup")

    expect(mocks.getBackupRestoreState).toHaveBeenCalledWith("a".repeat(32))
    expect(mocks.cancelControlledShutdown).toHaveBeenCalledOnce()
    expect(mocks.warning).toHaveBeenCalledWith("RestoreFailed", { description: "RestartUnavailable" })
  })

  it("releases the preparing state when restart and state checks both lose the host", async () => {
    mocks.restartForBackupRestore.mockRejectedValue(new TypeError("network failed"))
    mocks.getBackupRestoreState.mockRejectedValue(new TypeError("network failed"))
    await renderPage()
    await press("ChooseBackup")

    await press("RestoreBackup")

    expect(mocks.waitForControlledShutdownStart).toHaveBeenCalledOnce()
    expect(mocks.cancelControlledShutdown).toHaveBeenCalledOnce()
    expect(mocks.warning).toHaveBeenCalledWith("RestoreFailed", { description: "RestartUnavailable" })
    expect(container.textContent).not.toContain("PreparingRestore")
  })

  it("keeps preparing when the shutdown event confirms the app is closing", async () => {
    mocks.restartForBackupRestore.mockRejectedValue(new TypeError("network closed"))
    mocks.getBackupRestoreState.mockRejectedValue(new TypeError("network closed"))
    mocks.waitForControlledShutdownStart.mockResolvedValue(true)
    await renderPage()
    await press("ChooseBackup")

    await press("RestoreBackup")

    expect(mocks.cancelControlledShutdown).not.toHaveBeenCalled()
    expect(mocks.warning).not.toHaveBeenCalledWith("RestoreFailed", expect.anything())
    expect(container.textContent).toContain("PreparingRestore")
  })

  it("uses the restore outcome when restart finished after losing its response", async () => {
    const status = {
      success: true,
      code: "restore_complete",
      recoveryDirectoryName: "recovery-copy",
      backupCreatedAtUtc: null,
      backupAppVersion: null,
    }
    mocks.restartForBackupRestore.mockRejectedValue(new TypeError("network closed"))
    mocks.getBackupRestoreState.mockResolvedValue({ staged: false, restartRequested: false })
    await renderPage()
    await vi.waitFor(() => expect(mocks.consumeRestoreStatus).toHaveBeenCalledOnce())
    mocks.consumeRestoreStatus.mockResolvedValue(status)
    await press("ChooseBackup")

    await press("RestoreBackup")

    expect(mocks.success).toHaveBeenCalledWith("RestoreComplete", {
      description: "RestoreCompleteDescription:recovery-copy",
    })
    expect(mocks.cancelControlledShutdown).not.toHaveBeenCalled()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it("reports and consumes a completed restore outcome", async () => {
    mocks.consumeRestoreStatus.mockResolvedValue({
      success: true,
      code: "restore_complete",
      recoveryDirectoryName: "recovery-copy",
      backupCreatedAtUtc: "2026-09-11T12:00:00Z",
      backupAppVersion: "0.8.0-beta",
    })

    await renderPage()

    expect(mocks.success).toHaveBeenCalledWith("RestoreComplete", {
      description: "RestoreCompleteDescription:recovery-copy",
    })
    expect(mocks.consumeRestoreStatus).toHaveBeenCalledOnce()
  })

  it("reports a restore that was rolled back", async () => {
    mocks.consumeRestoreStatus.mockResolvedValue({
      success: false,
      code: "restore_interrupted_rolled_back",
      recoveryDirectoryName: "recovery-copy",
      backupCreatedAtUtc: null,
      backupAppVersion: null,
    })

    await renderPage()

    expect(mocks.warning).toHaveBeenCalledWith("RestoreRolledBack", {
      description: "RestoreRolledBackDescription",
    })
  })

  it.each([
    ["restore_instance_running", "RestoreDiscardedInstanceRunning"],
    ["restore_request_invalid", "RestoreDiscardedRequestInvalid"],
  ])("reports why a staged restore was discarded for %s", async (code, description) => {
    mocks.consumeRestoreStatus.mockResolvedValue({
      success: false,
      code,
      recoveryDirectoryName: null,
      backupCreatedAtUtc: null,
      backupAppVersion: null,
    })

    await renderPage()

    expect(mocks.warning).toHaveBeenCalledWith("RestoreFailed", { description })
    expect(mocks.warning).not.toHaveBeenCalledWith("RestoreRolledBack", expect.anything())
  })
})
