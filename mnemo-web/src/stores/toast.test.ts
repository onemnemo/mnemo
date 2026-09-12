// @vitest-environment jsdom

/**
 * App.EnableToasts turns off the pop-up card, not the notification list behind the
 * bell (its own description says so: "alerts appear only in the notification list").
 * So disabling it has to drop nothing from `history`, only skip `toasts`.
 */

import { afterEach, describe, expect, it } from "vitest"

import { useSettingsStore } from "@/settings/store"

import { toast, useToastStore } from "./toast"

afterEach(() => {
  useSettingsStore.setState({ values: {}, secrets: {}, loaded: false, failed: false })
  useToastStore.setState({ toasts: [], history: [] })
})

describe("toast spawn", () => {
  it("shows a pop-up and records history when App.EnableToasts is on (the default)", () => {
    useToastStore.getState().spawn("info", "Saved")

    expect(useToastStore.getState().toasts).toHaveLength(1)
    expect(useToastStore.getState().history).toHaveLength(1)
  })

  it("skips the pop-up but still records history when App.EnableToasts is off", () => {
    useSettingsStore.setState((s) => ({ values: { ...s.values, "App.EnableToasts": false } }))

    useToastStore.getState().spawn("info", "Saved")

    expect(useToastStore.getState().toasts).toHaveLength(0)
    expect(useToastStore.getState().history).toHaveLength(1)
  })
})

describe("progress toast lifecycle", () => {
  it("stays visible until its existing card becomes a final receipt", () => {
    const id = toast.progress("Backing up", { description: "C:\\Backups\\mnemo.mnemo-backup" })

    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({ id, type: "progress", durationMs: 0, revision: 0 }),
    ])
    expect(useToastStore.getState().history).toEqual([expect.objectContaining({ id, type: "progress" })])

    toast.update(id, {
      type: "success",
      title: "Backup complete",
      description: "C:\\Backups\\mnemo.mnemo-backup",
    })

    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({
        id,
        type: "success",
        title: "Backup complete",
        durationMs: 5000,
        revision: 1,
      }),
    ])
    expect(useToastStore.getState().history).toEqual([
      expect.objectContaining({ id, type: "success", title: "Backup complete" }),
    ])
  })

  it("updates notification history when pop-up toasts are disabled", () => {
    useSettingsStore.setState((state) => ({ values: { ...state.values, "App.EnableToasts": false } }))
    const id = toast.progress("Backing up")

    toast.update(id, { type: "warning", title: "Backup failed" })

    expect(useToastStore.getState().toasts).toHaveLength(0)
    expect(useToastStore.getState().history).toEqual([
      expect.objectContaining({ id, type: "warning", title: "Backup failed" }),
    ])
  })

  it("raises the completed result as the newest unread notification", () => {
    const id = toast.progress("Backing up")
    useToastStore.getState().markAllRead()
    toast.info("Something newer")

    toast.update(id, { type: "success", title: "Backup complete" })

    expect(useToastStore.getState().history.map((notification) => notification.id)).toEqual([
      id,
      expect.any(String),
    ])
    expect(useToastStore.getState().history[0]).toEqual(
      expect.objectContaining({ type: "success", seen: false, read: false }),
    )
  })

  it("removes a cancelled operation from both surfaces", () => {
    const id = toast.progress("Backing up")

    toast.discard(id)

    expect(useToastStore.getState().toasts).toHaveLength(0)
    expect(useToastStore.getState().history).toHaveLength(0)
  })
})
