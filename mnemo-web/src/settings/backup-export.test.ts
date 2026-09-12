import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/api/client"

const mocks = vi.hoisted(() => ({
  announceExport: vi.fn(),
  chooseExportTarget: vi.fn(),
  requestBackupExport: vi.fn(),
  saveServerExport: vi.fn(),
  progress: vi.fn(),
  update: vi.fn(),
  warning: vi.fn(),
}))

vi.mock("@/api/export-file", () => ({
  announceExport: mocks.announceExport,
  chooseExportTarget: mocks.chooseExportTarget,
  exportSaveOptions: (common: (key: string) => string) => ({
    dialogTitle: common("ExportSaveDialogTitle"),
    overwrite: {},
  }),
  saveServerExport: mocks.saveServerExport,
}))
vi.mock("@/stores/toast", () => ({
  toast: { progress: mocks.progress, update: mocks.update, warning: mocks.warning },
}))
vi.mock("./backup-api", () => ({ requestBackupExport: mocks.requestBackupExport }))

import { BACKUP_FILE_EXTENSION, backupFileName, createProfileBackup } from "./backup-export"

const t = (ns: string, key: string, params?: Record<string, string | number>) =>
  params?.date === undefined ? `${ns}.${key}` : `${ns}.${key}:${String(params.date)}`

const chosen = { status: "chosen", grant: "grant-1", path: "C:/Backups/Mnemo.mnemo-backup" } as const

beforeEach(() => {
  vi.clearAllMocks()
  mocks.chooseExportTarget.mockResolvedValue(chosen)
  mocks.progress.mockReturnValue("progress-1")
  mocks.saveServerExport.mockResolvedValue({ status: "saved", path: chosen.path })
  mocks.requestBackupExport.mockResolvedValue({})
})

describe("the backup file name", () => {
  it("is the translated stem, dated, with the backup extension", () => {
    expect(BACKUP_FILE_EXTENSION).toBe(".mnemo-backup")
    expect(backupFileName(t, new Date("2026-09-12T23:30:00Z"))).toBe("Settings.BackupFileName:2026-09-12.mnemo-backup")
  })
})

describe("creating a profile backup", () => {
  it("settles the destination, then writes through the backup route and reports on the progress toast", async () => {
    await createProfileBackup(t)

    expect(mocks.chooseExportTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: expect.stringMatching(/^Settings\.BackupFileName:\d{4}-\d{2}-\d{2}\.mnemo-backup$/),
        dialogTitle: "Common.ExportSaveDialogTitle",
      }),
    )
    const request = mocks.chooseExportTarget.mock.calls[0][0] as { fileName: string }
    expect(mocks.progress).toHaveBeenCalledWith("Settings.BackingUp", { description: request.fileName })
    expect(mocks.saveServerExport).toHaveBeenCalledWith(request, expect.any(Function), chosen)

    const send = mocks.saveServerExport.mock.calls[0][1] as (grant: string | null) => Promise<unknown>
    await send("grant-1")
    expect(mocks.requestBackupExport).toHaveBeenCalledWith("grant-1")

    expect(mocks.announceExport).toHaveBeenCalledWith(
      { status: "saved", path: chosen.path },
      { title: "Settings.BackupComplete", downloaded: "Common.TransferExportFinished" },
      "progress-1",
    )
    expect(mocks.warning).not.toHaveBeenCalled()
  })

  it("runs one backup when a second surface starts while the first is still choosing", async () => {
    let choose!: (target: typeof chosen) => void
    mocks.chooseExportTarget.mockReturnValue(
      new Promise<typeof chosen>((resolve) => {
        choose = resolve
      }),
    )

    const first = createProfileBackup(t)
    const second = createProfileBackup(t)
    expect(second).toBe(first)
    expect(mocks.chooseExportTarget).toHaveBeenCalledOnce()

    choose(chosen)
    await Promise.all([first, second])
    expect(mocks.saveServerExport).toHaveBeenCalledOnce()

    mocks.chooseExportTarget.mockResolvedValue(chosen)
    await createProfileBackup(t)
    expect(mocks.chooseExportTarget).toHaveBeenCalledTimes(2)
  })

  it("says nothing when the chooser is dismissed", async () => {
    mocks.chooseExportTarget.mockResolvedValue({ status: "declined", outcome: { status: "cancelled" } })

    await createProfileBackup(t)

    expect(mocks.progress).not.toHaveBeenCalled()
    expect(mocks.saveServerExport).not.toHaveBeenCalled()
    expect(mocks.announceExport).not.toHaveBeenCalled()
    expect(mocks.warning).not.toHaveBeenCalled()
  })

  it("turns the progress toast into the failure rather than raising a second one", async () => {
    mocks.saveServerExport.mockRejectedValue(new ApiError("failed", 500, "internal_error"))

    await expect(createProfileBackup(t)).resolves.toBeUndefined()

    expect(mocks.update).toHaveBeenCalledWith("progress-1", {
      type: "warning",
      title: "Settings.BackupFailed",
      description: "Errors.InternalError",
    })
    expect(mocks.warning).not.toHaveBeenCalled()
    expect(mocks.announceExport).not.toHaveBeenCalled()
  })

  it("warns on its own when the failure comes before any progress was shown", async () => {
    mocks.chooseExportTarget.mockRejectedValue(new ApiError("refused", 409, "unknown_grant"))

    await expect(createProfileBackup(t)).resolves.toBeUndefined()

    expect(mocks.warning).toHaveBeenCalledWith("Settings.BackupFailed", { description: "Errors.UnknownGrant" })
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
