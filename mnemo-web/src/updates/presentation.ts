import type { UpdateStatus } from "./types"

/**
 * What the updater row says and offers, derived from the status alone.
 *
 * Kept apart from the row because this is the part that can be wrong in a way nobody
 * sees: an offer to install something that was never downloaded, or a "you are up to
 * date" under a build the selected channel cannot actually reach. The row renders what
 * these answer and owns no rule of its own.
 */

/** The one thing worth pressing at this moment. */
export type UpdateActionKind = "check" | "download" | "apply" | "open-releases"

export interface UpdateAction {
  kind: UpdateActionKind
  /** A Settings translation key. */
  label: string
}

export interface UpdateNote {
  /** A Settings translation key. */
  key: string
  params?: Record<string, string>
}

/**
 * The single next step.
 *
 * One action rather than three, because at any moment only one of check, download and
 * restart applies, and a row of controls where two are always dead reads as broken.
 */
export function nextUpdateAction(status: UpdateStatus | null): UpdateAction {
  const check: UpdateAction = { kind: "check", label: "CheckNow" }
  if (!status) return check

  if (status.stage === "Ready") return { kind: "apply", label: "RestartToUpdate" }

  if (status.stage === "Available") {
    // Nothing here can install into a portable or unpackaged layout, so the honest
    // offer is the download page rather than a button that would fail.
    return status.supportsInAppApply
      ? { kind: "download", label: "DownloadUpdate" }
      : { kind: "open-releases", label: "ViewOnGitHub" }
  }

  return check
}

/**
 * Whether the row offers to stop the app raising this version by itself.
 *
 * Only alongside a found update, because skipping is about one version and there is
 * nothing to name otherwise. It stays on screen once pressed, disabled, so the choice
 * reads back: a control that vanishes leaves no way to tell "already skipped" from
 * "never offered".
 */
export function offersSkip(status: UpdateStatus | null): boolean {
  return status?.stage === "Available" && Boolean(status.availableVersion)
}

/** The line under the version, or nothing when there is nothing to add to it. */
export function updateNote(status: UpdateStatus | null): UpdateNote | null {
  if (!status) return null

  // Ahead of the stage, because it explains why a check keeps finding nothing.
  if (status.awaitingChannelCatchUp) return { key: "UpdateChannelCatchUpNotice" }

  switch (status.stage) {
    case "UpToDate":
      return { key: "UpdatesUpToDate" }
    case "Available":
      return status.supportsInAppApply
        ? { key: "UpdateAvailableVersionFormat", params: { 0: status.availableVersion ?? "" } }
        : { key: "UpdateManualDownloadHint" }
    case "Downloading":
      return { key: "UpdateDownloadingFormat", params: { 0: String(status.downloadProgress) } }
    case "Ready":
      return { key: "UpdateReadyToInstall" }
    case "Failed":
      return { key: status.error === "download_failed" ? "UpdateDownloadFailed" : "UpdateCheckFailed" }
    default:
      return null
  }
}

/**
 * Whether the button should be dead.
 *
 * Both halves matter: `busy` covers the moment between pressing and the host answering,
 * and the two stages cover work the host is doing that this window may not have started,
 * such as a download still running after a reload.
 */
export function isUpdateWorking(status: UpdateStatus | null, busy: boolean): boolean {
  return busy || status?.stage === "Checking" || status?.stage === "Downloading"
}
