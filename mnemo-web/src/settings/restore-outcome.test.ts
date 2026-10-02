import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useI18nStore } from "@/i18n/store"
import { useToastStore } from "@/stores/toast"

import type { RestoreStatus } from "./backup-api"

const api = vi.hoisted(() => ({ consumeRestoreStatus: vi.fn() }))
vi.mock("./backup-api", () => api)

const { announcePendingRestoreOutcome, resetRestoreOutcomeCheckForTests } = await import("./restore-outcome")

function status(overrides: Partial<RestoreStatus>): RestoreStatus {
  return {
    success: false,
    code: "restore_interrupted_rolled_back",
    recoveryDirectoryName: "recovery-copy",
    backupCreatedAtUtc: null,
    backupAppVersion: null,
    ...overrides,
  }
}

beforeEach(() => {
  resetRestoreOutcomeCheckForTests()
  useToastStore.setState({ toasts: [], history: [] })
  useI18nStore.setState({
    bundle: {
      Settings: {
        RestoreComplete: "Backup restored",
        RestoreCompleteDescription: "Your previous data is in {folder}.",
        RestoreFailed: "Restore failed",
        RestoreRolledBack: "Restore rolled back",
        RestoreRolledBackDescription: "Your data is as it was.",
        RestoreDiscardedInstanceRunning: "Another window was open.",
        RestoreDiscardedRequestInvalid: "The restore request was invalid.",
      },
    },
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

async function announced() {
  await vi.waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1))
  return useToastStore.getState().toasts[0]
}

describe("announcePendingRestoreOutcome", () => {
  it("reports a completed restore on whatever route the app opens", async () => {
    api.consumeRestoreStatus.mockResolvedValue(status({ success: true, code: "restore_complete" }))

    announcePendingRestoreOutcome()
    const toast = await announced()

    expect(toast.type).toBe("success")
    expect(toast.title).toBe("Backup restored")
    expect(toast.description).toBe("Your previous data is in recovery-copy.")
  })

  it("keeps a rolled back restore on screen until it is dismissed", async () => {
    api.consumeRestoreStatus.mockResolvedValue(status({}))

    announcePendingRestoreOutcome()
    const toast = await announced()

    expect(toast.type).toBe("warning")
    expect(toast.title).toBe("Restore rolled back")
    expect(toast.description).toBe("Your data is as it was.")
    expect(toast.durationMs).toBe(0)
  })

  it.each([
    ["restore_instance_running", "Another window was open."],
    ["restore_request_invalid", "The restore request was invalid."],
  ])("says why a staged restore was discarded for %s", async (code, description) => {
    api.consumeRestoreStatus.mockResolvedValue(status({ code, recoveryDirectoryName: null }))

    announcePendingRestoreOutcome()
    const toast = await announced()

    expect(toast.title).toBe("Restore failed")
    expect(toast.description).toBe(description)
    expect(toast.durationMs).toBe(0)
  })

  it("says nothing when no restore ran", async () => {
    api.consumeRestoreStatus.mockResolvedValue(null)

    announcePendingRestoreOutcome()
    await vi.waitFor(() => expect(api.consumeRestoreStatus).toHaveBeenCalledOnce())
    await Promise.resolve()

    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it("asks the host once per page load", async () => {
    api.consumeRestoreStatus.mockResolvedValue(null)

    announcePendingRestoreOutcome()
    announcePendingRestoreOutcome()

    expect(api.consumeRestoreStatus).toHaveBeenCalledOnce()
  })

  it("swallows a failed read rather than leaving it unhandled", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    api.consumeRestoreStatus.mockRejectedValue(new Error("host gone"))

    announcePendingRestoreOutcome()
    await vi.waitFor(() => expect(error).toHaveBeenCalled())

    expect(useToastStore.getState().toasts).toHaveLength(0)
    error.mockRestore()
  })
})
