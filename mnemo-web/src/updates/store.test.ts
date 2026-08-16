/**
 * The updater store. It holds no rules of its own, so what is worth pinning is the
 * handling around the requests: that a failed read does not blank a row someone is
 * reading, that a button cannot ask for the same work twice, that nothing is saved
 * after the process has been told to restart, and that only a check the user did not
 * ask for interrupts them with a toast.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { notifySubscribers, resetSubscribersForTests } from "@/events/subscribers"
import { useI18nStore } from "@/i18n/store"
import { useToastStore } from "@/stores/toast"

import type { UpdateStatus } from "./types"

const api = vi.hoisted(() => ({
  fetchUpdateStatus: vi.fn(),
  requestUpdateCheck: vi.fn(),
  requestUpdateDownload: vi.fn(),
  requestUpdateApply: vi.fn(),
}))
vi.mock("./api", () => api)

const shutdown = vi.hoisted(() => ({ runShutdown: vi.fn(() => Promise.resolve()) }))
vi.mock("@/app/shutdown", () => shutdown)

const { startUpdateWatch, useUpdateStore } = await import("./store")


function status(patch: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    stage: "Idle",
    version: "0.8.0",
    channel: "stable",
    supportsInAppApply: true,
    awaitingChannelCatchUp: false,
    lastCheckedUtc: null,
    availableVersion: null,
    releaseNotesMarkdown: null,
    downloadProgress: 0,
    error: null,
    ...patch,
  }
}

const available = status({ stage: "Available", availableVersion: "0.9.0" })

/** A promise the test decides when to settle. */
function gate<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  useUpdateStore.setState({ status: null, busy: false })
  useToastStore.setState({ toasts: [], history: [] })
  useI18nStore.setState({ bundle: {} })
  resetSubscribersForTests()
  api.fetchUpdateStatus.mockResolvedValue(status())
  api.requestUpdateCheck.mockResolvedValue(status({ stage: "UpToDate" }))
  api.requestUpdateDownload.mockResolvedValue(status({ stage: "Downloading" }))
  api.requestUpdateApply.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("refresh", () => {
  it("takes the host's status", async () => {
    api.fetchUpdateStatus.mockResolvedValue(available)

    await useUpdateStore.getState().refresh()
    expect(useUpdateStore.getState().status).toEqual(available)
  })

  it("keeps the last known status when the read fails", async () => {
    useUpdateStore.setState({ status: available })
    api.fetchUpdateStatus.mockRejectedValue(new Error("offline"))

    await useUpdateStore.getState().refresh()
    // Blanking the row would read as "no updates" to whoever is looking at it, which
    // one failed request is no evidence of.
    expect(useUpdateStore.getState().status).toEqual(available)
  })
})

describe("check", () => {
  it("tells the host whether the user asked for it", async () => {
    await useUpdateStore.getState().check(false)
    expect(api.requestUpdateCheck).toHaveBeenCalledWith(false)

    await useUpdateStore.getState().check(true)
    expect(api.requestUpdateCheck).toHaveBeenCalledWith(true)
  })

  it("drops a second press while the first is still running", async () => {
    const first = gate<UpdateStatus>()
    api.requestUpdateCheck.mockReturnValueOnce(first.promise)

    const running = useUpdateStore.getState().check(false)
    await useUpdateStore.getState().check(false)
    expect(api.requestUpdateCheck).toHaveBeenCalledOnce()

    first.resolve(status({ stage: "UpToDate" }))
    await running
  })

  it("clears busy when the check fails, so the button comes back", async () => {
    api.requestUpdateCheck.mockRejectedValue(new Error("offline"))

    await useUpdateStore.getState().check(false)
    expect(useUpdateStore.getState().busy).toBe(false)
  })

  it("announces an update the user did not go looking for", async () => {
    useI18nStore.setState({
      bundle: { Settings: { UpdateAvailableVersionFormat: "Version {0} is available.", UpdatesCategoryTitle: "Updates" } },
    })
    api.requestUpdateCheck.mockResolvedValue(available)

    await useUpdateStore.getState().check(true)

    const [toast] = useToastStore.getState().toasts
    expect(toast.description).toBe("Version 0.9.0 is available.")
    // The toast outlives itself in the bell list, where a label with nowhere to go
    // would be a dead end.
    expect(toast.notificationAction).toEqual({ label: "Updates", href: "/settings/Updates" })
  })

  it("stays quiet about a check the user pressed", async () => {
    api.requestUpdateCheck.mockResolvedValue(available)

    await useUpdateStore.getState().check(false)
    // The row they are looking at already says it.
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it("stays quiet when an automatic check finds nothing", async () => {
    await useUpdateStore.getState().check(true)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it("stays quiet when the host declines the automatic check", async () => {
    // Declined by the auto-check setting or the cooldown: the status comes back
    // unchanged, which must not be mistaken for a fresh finding.
    api.requestUpdateCheck.mockResolvedValue(status({ stage: "Idle" }))

    await useUpdateStore.getState().check(true)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })
})

describe("download", () => {
  it("takes the status the host answers with", async () => {
    await useUpdateStore.getState().download()
    expect(useUpdateStore.getState().status?.stage).toBe("Downloading")
  })

  it("leaves the stage alone when the request fails", async () => {
    useUpdateStore.setState({ status: available })
    api.requestUpdateDownload.mockRejectedValue(new Error("nope"))

    await useUpdateStore.getState().download()
    expect(useUpdateStore.getState().status).toEqual(available)
    expect(useUpdateStore.getState().busy).toBe(false)
  })
})

describe("apply", () => {
  it("flushes everything before asking for the restart", async () => {
    const order: string[] = []
    shutdown.runShutdown.mockImplementation(async () => {
      order.push("flush")
    })
    api.requestUpdateApply.mockImplementation(async () => {
      order.push("apply")
    })

    await useUpdateStore.getState().apply()
    // The host replaces this process moments later. An update that eats an unsaved
    // note is worse than no update at all.
    expect(order).toEqual(["flush", "apply"])
  })

  it("stays busy once the restart is under way", async () => {
    await useUpdateStore.getState().apply()
    // Re-enabling the button would only let someone ask twice for a process that is
    // already on its way out.
    expect(useUpdateStore.getState().busy).toBe(true)
  })

  it("comes back when the restart could not be asked for", async () => {
    api.requestUpdateApply.mockRejectedValue(new Error("not ready"))

    await useUpdateStore.getState().apply()
    expect(useUpdateStore.getState().busy).toBe(false)
  })

  it("does not restart when the flush fails", async () => {
    shutdown.runShutdown.mockRejectedValue(new Error("disk full"))

    await useUpdateStore.getState().apply()
    expect(api.requestUpdateApply).not.toHaveBeenCalled()
    expect(useUpdateStore.getState().busy).toBe(false)
  })
})

describe("startUpdateWatch", () => {
  it("reads the local state before running the launch check", async () => {
    const order: string[] = []
    api.fetchUpdateStatus.mockImplementation(async () => {
      order.push("state")
      return status()
    })
    api.requestUpdateCheck.mockImplementation(async () => {
      order.push("check")
      return status({ stage: "UpToDate" })
    })

    const stop = startUpdateWatch()
    await vi.waitFor(() => expect(order).toEqual(["state", "check"]))
    // The read touches nothing but this machine, so the version shows even offline.
    expect(api.requestUpdateCheck).toHaveBeenCalledWith(true)
    stop()
  })

  it("still runs the check when the state read fails", async () => {
    api.fetchUpdateStatus.mockRejectedValue(new Error("offline"))

    const stop = startUpdateWatch()
    await vi.waitFor(() => expect(api.requestUpdateCheck).toHaveBeenCalledOnce())
    stop()
  })

  it("applies a status the host pushes", async () => {
    const stop = startUpdateWatch()
    await vi.waitFor(() => expect(api.requestUpdateCheck).toHaveBeenCalled())

    notifySubscribers({ type: "update-status", data: status({ stage: "Downloading", downloadProgress: 30 }) })
    expect(useUpdateStore.getState().status?.downloadProgress).toBe(30)
    stop()
  })

  it("stops listening once it is stopped", async () => {
    const stop = startUpdateWatch()
    await vi.waitFor(() => expect(api.requestUpdateCheck).toHaveBeenCalled())
    stop()

    notifySubscribers({ type: "update-status", data: status({ stage: "Ready" }) })
    expect(useUpdateStore.getState().status?.stage).not.toBe("Ready")
  })
})
