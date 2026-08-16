import { create } from "zustand"

import { runShutdown } from "@/app/shutdown"
import { onAppEvent } from "@/events/subscribers"
import { EventType } from "@/events/types"
import { useI18nStore } from "@/i18n/store"
import { createTranslate } from "@/i18n/translate"
import { toast } from "@/stores/toast"

import { fetchUpdateStatus, requestUpdateApply, requestUpdateCheck, requestUpdateDownload } from "./api"
import type { UpdateStatus } from "./types"

/** Where the update settings live, for the toast's link into them. */
const UPDATES_SETTINGS_ROUTE = "/settings/Updates"

interface UpdateState {
  /** Null until the first status arrives. */
  status: UpdateStatus | null
  /** A request is in flight. Separate from the stage, which describes the updater rather than us. */
  busy: boolean

  refresh: () => Promise<void>
  check: (automatic: boolean) => Promise<void>
  download: () => Promise<void>
  apply: () => Promise<void>
  /** Applied to every status the host sends, whether asked for or pushed. */
  receive: (status: UpdateStatus) => void
}

/**
 * The updater, as one object the host owns and this mirrors.
 *
 * Nothing is derived here. Whether an update exists, how far a download has got and
 * whether the selected channel is behind the running build are all answered by the
 * host, because only the host can see the feed. Every request and every push replaces
 * the whole status, so there is no partial state to reconcile.
 */
export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: null,
  busy: false,

  receive: (status) => set({ status }),

  refresh: async () => {
    try {
      set({ status: await fetchUpdateStatus() })
    } catch {
      // Leave the last known status up. A failed status read says nothing about the
      // updater, only about this one request, and blanking the row would read as
      // "no updates" to someone who is looking at it.
    }
  },

  check: async (automatic) => {
    if (get().busy) return
    set({ busy: true })
    try {
      const status = await requestUpdateCheck(automatic)
      set({ status })
      if (automatic) announce(status)
    } catch {
      // A manual check reports through the row it was pressed in, which reads `busy`
      // and the stage; an automatic one says nothing, because nobody asked.
    } finally {
      set({ busy: false })
    }
  },

  download: async () => {
    if (get().busy) return
    set({ busy: true })
    try {
      set({ status: await requestUpdateDownload() })
    } catch {
      // The stage stays where it was, so the button stays pressable.
    } finally {
      set({ busy: false })
    }
  },

  apply: async () => {
    if (get().busy) return
    set({ busy: true })
    try {
      // The same flush the window close runs. The host replaces this process moments
      // after the call, and an update that eats an unsaved note is worse than no
      // update at all.
      await runShutdown()
      await requestUpdateApply()
    } catch {
      set({ busy: false })
    }
    // No `finally`: on success the process is on its way out, and clearing `busy`
    // would re-enable a button whose only effect now is to ask twice.
  },
}))

/**
 * Tells the user about an update they did not go looking for.
 *
 * Only for the automatic check. A manual one is being watched by whoever pressed the
 * button, and a toast repeating what the row already says is noise.
 */
function announce(status: UpdateStatus): void {
  if (status.stage !== "Available" || !status.availableVersion) return

  const t = createTranslate(useI18nStore.getState().bundle)
  toast.info(t("Settings", "UpdateAvailableTitle"), {
    description: t("Settings", "UpdateAvailableVersionFormat", { 0: status.availableVersion }),
    notificationAction: { label: t("Settings", "UpdatesCategoryTitle"), href: UPDATES_SETTINGS_ROUTE },
  })
}

/**
 * Starts mirroring the host's updater state, and runs the launch check.
 *
 * The status is read before the check because the two answer different questions. The
 * read touches nothing but this machine, so the version and whether this build can
 * update itself are known even with no network; the check is the automatic kind, and
 * the host decides whether it happens at all, since the auto-check setting and the
 * cooldown both live where the last check time is stored.
 */
export function startUpdateWatch(): () => void {
  const stop = onAppEvent(EventType.UpdateStatus, (event) => {
    useUpdateStore.getState().receive(event.data as UpdateStatus)
  })

  void useUpdateStore
    .getState()
    .refresh()
    .then(() => useUpdateStore.getState().check(true))

  return stop
}
