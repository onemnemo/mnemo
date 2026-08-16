import { apiFetch, apiSend } from "@/api/client"

import type { UpdateLaunchNotice, UpdateStatus } from "./types"

// The update routes. Check, snooze and skip answer when they are done; download and
// apply answer immediately and report the rest over the event stream.

export function fetchUpdateStatus(): Promise<UpdateStatus> {
  return apiFetch<UpdateStatus>("/updates/state")
}

/**
 * Runs a check.
 *
 * `automatic` is the app's own startup check, which the host is allowed to decline: it
 * respects the auto-check setting and a cooldown between checks. A check the user
 * pressed a button for is never declined, so it passes false.
 */
export function requestUpdateCheck(automatic: boolean): Promise<UpdateStatus> {
  return apiFetch<UpdateStatus>("/updates/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ automatic }),
  })
}

/**
 * Tells the host a launch has happened.
 *
 * Called once on mount. It spends a launch of any active snooze and hands back the
 * version this build was updated into, which only the launch after an update carries.
 * The host answers null to a second call in the same run, so a reload cannot spend a
 * snooze twice or repeat a toast that has already been shown.
 */
export function reportUpdateLaunch(): Promise<UpdateLaunchNotice> {
  return apiFetch<UpdateLaunchNotice>("/updates/launch", { method: "POST" })
}

/** Holds the update prompt off for a day or two launches, whichever comes first. */
export function requestUpdateSnooze(): Promise<UpdateStatus> {
  return apiFetch<UpdateStatus>("/updates/snooze", { method: "POST" })
}

/** Stops the app raising the pending version by itself. It stays installable from Settings. */
export function requestUpdateSkip(): Promise<UpdateStatus> {
  return apiFetch<UpdateStatus>("/updates/skip", { method: "POST" })
}

/** Starts the download. Returns as soon as it has started, not when it finishes. */
export function requestUpdateDownload(): Promise<UpdateStatus> {
  return apiFetch<UpdateStatus>("/updates/download", { method: "POST" })
}

/**
 * Restarts into the downloaded update.
 *
 * The process is replaced shortly after this resolves, so anything that still needs
 * saving must already be saved when it is called.
 */
export function requestUpdateApply(): Promise<void> {
  return apiSend("/updates/apply", { method: "POST" })
}
