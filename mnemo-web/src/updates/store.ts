import { create } from "zustand"

import { navigateTo } from "@/app/router"
import { runShutdown } from "@/app/shutdown"
import { onAppEvent } from "@/events/subscribers"
import { EventType } from "@/events/types"
import { useI18nStore } from "@/i18n/store"
import { createTranslate } from "@/i18n/translate"
import { toast } from "@/stores/toast"

import {
  fetchUpdateStatus,
  reportUpdateLaunch,
  requestUpdateApply,
  requestUpdateCheck,
  requestUpdateDownload,
  requestUpdateSkip,
  requestUpdateSnooze,
} from "./api"
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
  /** "Later": holds the prompt off for a day or two launches, whichever comes first. */
  snooze: () => Promise<void>
  /** "Skip this version": stops the prompt naming it again. It stays installable. */
  skip: () => Promise<void>
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

  // Apply has no finally because success exits the process. A pushed failure must clear busy to
  // allow retry.
  receive: (status) => set(status.stage === "Failed" ? { status, busy: false } : { status }),

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

  // Neither of these takes the `busy` flag. They are settings writes rather than updater
  // work, and the toast that raises them can be answered while a check is still running.
  snooze: async () => {
    try {
      set({ status: await requestUpdateSnooze() })
    } catch {
      // The prompt has already gone from the screen either way, and the next launch will
      // ask again rather than never asking.
    }
  },

  skip: async () => {
    try {
      set({ status: await requestUpdateSkip() })
    } catch {
      // Same: nothing on screen depends on it having landed except the disabled state of
      // the button that sent it, which a later status will settle.
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
 *
 * It waits rather than fading, because it asks a question: an update notice that
 * disappears after five seconds has nagged without giving anyone the chance to answer.
 * Closing it counts as "Later", since ignoring a prompt is how most people say that, and
 * an app that reads a dismissal as "ask me again in an hour" has not listened.
 */
function announce(status: UpdateStatus): void {
  if (status.stage !== "Available" || !status.availableVersion || !status.shouldPrompt) return

  const t = createTranslate(useI18nStore.getState().bundle)
  const later = () => void useUpdateStore.getState().snooze()

  toast.info(t("Settings", "UpdateAvailableTitle"), {
    description: t("Settings", "UpdateAvailableVersionFormat", { 0: status.availableVersion }),
    durationMs: 0,
    notificationAction: { label: t("Settings", "UpdatesCategoryTitle"), href: UPDATES_SETTINGS_ROUTE },
    primary: { label: t("Settings", "UpdateNow"), onClick: () => openUpdate(status) },
    secondary: { label: t("Settings", "UpdateToastLater"), onClick: later },
    onDismissed: later,
  })
}

/**
 * What "Update now" does: opens the row that owns the rest of the flow, and starts the
 * download on the way there.
 *
 * Both halves are needed. Starting the download alone would leave the progress and the
 * restart button on a page nobody is looking at, and opening the page alone would ask
 * for a second press to do the thing that was just pressed.
 */
function openUpdate(status: UpdateStatus): void {
  navigateTo(UPDATES_SETTINGS_ROUTE)
  // A portable build has nothing to download into; its row offers the releases page instead.
  if (status.supportsInAppApply) void useUpdateStore.getState().download()
}

/** Says once that the app came up as a newer version than it went down as. */
function announceInstalled(version: string): void {
  const t = createTranslate(useI18nStore.getState().bundle)
  toast.success(t("Settings", "PostUpdateToastTitle"), {
    description: t("Settings", "PostUpdateToastDescriptionFormat", { 0: version }),
  })
}

/**
 * Starts mirroring the host's updater state, and runs the launch check.
 *
 * The order is the order the user should read it in. The launch notice goes first
 * because it is about the update that already happened, and arriving after a prompt
 * about the next one would be backwards. The status is read before the check because
 * the two answer different questions: the read touches nothing but this machine, so the
 * version and whether this build can update itself are known even with no network. The
 * check is the automatic kind, and the host decides whether it happens at all, since
 * the auto-check setting and the cooldown both live where the last check time is stored.
 */
export function startUpdateWatch(): () => void {
  const stop = onAppEvent(EventType.UpdateStatus, (event) => {
    useUpdateStore.getState().receive(event.data as UpdateStatus)
  })

  void reportUpdateLaunch()
    .then((notice) => {
      if (notice.updatedToVersion) announceInstalled(notice.updatedToVersion)
    })
    .catch(() => {
      // Nothing here is worth reporting: the worst case is a version the user already
      // sees in Settings going unmentioned.
    })
    .then(() => useUpdateStore.getState().refresh())
    .then(() => useUpdateStore.getState().check(true))

  return stop
}
