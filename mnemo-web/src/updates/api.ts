import { apiFetch, apiSend } from "@/api/client"

import type { UpdateStatus } from "./types"

// The four update routes. Check answers when it is done; download and apply answer
// immediately and report the rest over the event stream.

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
