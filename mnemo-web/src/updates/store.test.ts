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
  reportUpdateLaunch: vi.fn(),
  requestUpdateCheck: vi.fn(),
  requestUpdateDownload: vi.fn(),
  requestUpdateApply: vi.fn(),
  requestUpdateSnooze: vi.fn(),
  requestUpdateSkip: vi.fn(),
}))
vi.mock("./api", () => api)

const shutdown = vi.hoisted(() => ({ runShutdown: vi.fn(() => Promise.resolve()) }))
vi.mock("@/app/shutdown", () => shutdown)

const router = vi.hoisted(() => ({ navigateTo: vi.fn() }))
vi.mock("@/app/router", () => router)

const { startUpdateWatch, useUpdateStore } = await import("./store")


function status(patch: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    stage: "Idle",
    version: "0.8.0",
    channel: "stable",
    runningChannel: "stable",
    supportsInAppApply: true,
    awaitingChannelCatchUp: false,
    lastCheckedUtc: null,
    availableVersion: null,
    releaseNotesMarkdown: null,
    downloadProgress: 0,
    shouldPrompt: false,
    skipped: false,
    error: null,
    ...patch,
  }
}

const available = status({ stage: "Available", availableVersion: "0.9.0", shouldPrompt: true })

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
  api.reportUpdateLaunch.mockResolvedValue({ updatedToVersion: null })
  api.requestUpdateCheck.mockResolvedValue(status({ stage: "UpToDate" }))
  api.requestUpdateDownload.mockResolvedValue(status({ stage: "Downloading" }))
  api.requestUpdateApply.mockResolvedValue(undefined)
  api.requestUpdateSnooze.mockResolvedValue(status({ ...available, shouldPrompt: false }))
  api.requestUpdateSkip.mockResolvedValue(status({ ...available, shouldPrompt: false, skipped: true }))
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

  it("stays quiet about a version the host says not to prompt for", async () => {
    // Snoozed or skipped. The finding is real and the row still shows it; what was
    // asked for is to stop being interrupted about it.
    api.requestUpdateCheck.mockResolvedValue(status({ ...available, shouldPrompt: false }))

    await useUpdateStore.getState().check(true)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it("waits for an answer rather than fading", async () => {
    api.requestUpdateCheck.mockResolvedValue(available)

    await useUpdateStore.getState().check(true)
    // A prompt that asks a question and leaves after five seconds has nagged without
    // giving anyone the chance to answer it.
    expect(useToastStore.getState().toasts[0].durationMs).toBe(0)
  })

  it("opens the row and starts the download when the prompt is accepted", async () => {
    api.requestUpdateCheck.mockResolvedValue(available)
    await useUpdateStore.getState().check(true)

    useToastStore.getState().toasts[0].primary?.onClick()
    await vi.waitFor(() => expect(api.requestUpdateDownload).toHaveBeenCalledOnce())
    expect(router.navigateTo).toHaveBeenCalledWith("/settings/Updates")
  })

  it("only opens the row for a build that cannot download into itself", async () => {
    api.requestUpdateCheck.mockResolvedValue(status({ ...available, supportsInAppApply: false }))
    await useUpdateStore.getState().check(true)

    useToastStore.getState().toasts[0].primary?.onClick()
    expect(router.navigateTo).toHaveBeenCalledWith("/settings/Updates")
    // The row sends it to the releases page instead; starting a download here would
    // begin something that cannot finish.
    expect(api.requestUpdateDownload).not.toHaveBeenCalled()
  })

  it("snoozes when the prompt is answered with Later", async () => {
    api.requestUpdateCheck.mockResolvedValue(available)
    await useUpdateStore.getState().check(true)

    useToastStore.getState().toasts[0].secondary?.onClick()
    await vi.waitFor(() => expect(api.requestUpdateSnooze).toHaveBeenCalledOnce())
  })

  it("reads closing the prompt as Later", async () => {
    api.requestUpdateCheck.mockResolvedValue(available)
    await useUpdateStore.getState().check(true)

    useToastStore.getState().toasts[0].onDismissed?.()
    // Ignoring a prompt is how most people say "not now", and asking again an hour
    // later would not be listening.
    await vi.waitFor(() => expect(api.requestUpdateSnooze).toHaveBeenCalledOnce())
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

  it("stays busy while the restart is still expected", async () => {
    await useUpdateStore.getState().apply()
    // Keep the action busy until apply fails or the process exits.
    expect(useUpdateStore.getState().busy).toBe(true)
  })

  it("comes back once the host says the apply failed", async () => {
    await useUpdateStore.getState().apply()

    useUpdateStore.getState().receive(status({ stage: "Failed", error: "apply_failed" }))

    expect(useUpdateStore.getState().busy).toBe(false)
  })

  it("leaves the flag alone while a stage is still working", () => {
    useUpdateStore.setState({ busy: true })

    useUpdateStore.getState().receive(status({ stage: "Downloading" }))

    // Unrelated status events must not enable a second action while one is pending.
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

describe("snooze and skip", () => {
  it("takes the status the host answers the snooze with", async () => {
    await useUpdateStore.getState().snooze()
    expect(useUpdateStore.getState().status?.shouldPrompt).toBe(false)
  })

  it("takes the status the host answers the skip with", async () => {
    await useUpdateStore.getState().skip()
    expect(useUpdateStore.getState().status?.skipped).toBe(true)
  })

  it("answers a prompt that arrived during a check", async () => {
    // Both are settings writes rather than updater work, so neither waits on `busy`;
    // a toast raised by a check the user can already see must stay answerable.
    useUpdateStore.setState({ busy: true })

    await useUpdateStore.getState().snooze()
    await useUpdateStore.getState().skip()
    expect(api.requestUpdateSnooze).toHaveBeenCalledOnce()
    expect(api.requestUpdateSkip).toHaveBeenCalledOnce()
  })

  it("leaves the status alone when the write fails", async () => {
    useUpdateStore.setState({ status: available })
    api.requestUpdateSnooze.mockRejectedValue(new Error("offline"))

    await useUpdateStore.getState().snooze()
    // The next launch asks again, which is the safe direction to fail in.
    expect(useUpdateStore.getState().status).toEqual(available)
  })
})

describe("startUpdateWatch", () => {
  it("says once that the app came up as a newer version", async () => {
    useI18nStore.setState({
      bundle: { Settings: { PostUpdateToastTitle: "Update installed", PostUpdateToastDescriptionFormat: "Updated to version {0}." } },
    })
    api.reportUpdateLaunch.mockResolvedValue({ updatedToVersion: "0.9.0" })

    const stop = startUpdateWatch()
    await vi.waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1))
    const [toast] = useToastStore.getState().toasts
    expect(toast.title).toBe("Update installed")
    expect(toast.description).toBe("Updated to version 0.9.0.")
    stop()
  })

  it("says nothing about a launch that did not come out of an update", async () => {
    const stop = startUpdateWatch()
    await vi.waitFor(() => expect(api.requestUpdateCheck).toHaveBeenCalled())
    expect(useToastStore.getState().toasts).toHaveLength(0)
    stop()
  })

  it("reports the launch before the update it is about to look for", async () => {
    const order: string[] = []
    api.reportUpdateLaunch.mockImplementation(async () => {
      order.push("launch")
      return { updatedToVersion: null }
    })
    api.fetchUpdateStatus.mockImplementation(async () => {
      order.push("state")
      return status()
    })

    const stop = startUpdateWatch()
    // The launch notice is about the update that already happened. Arriving after a
    // prompt about the next one would read backwards.
    await vi.waitFor(() => expect(order).toEqual(["launch", "state"]))
    stop()
  })

  it("still runs the check when the launch report fails", async () => {
    api.reportUpdateLaunch.mockRejectedValue(new Error("offline"))

    const stop = startUpdateWatch()
    await vi.waitFor(() => expect(api.requestUpdateCheck).toHaveBeenCalledOnce())
    stop()
  })

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
