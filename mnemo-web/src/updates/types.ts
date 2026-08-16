// The updater as the host describes it. Mirrors Mnemo.Host/Updates/UpdateCoordinator.cs.

/** Where the update pipeline is. Serialized by name, so these strings are the contract. */
export type UpdateStage =
  | "Idle"
  | "Checking"
  | "UpToDate"
  | "Available"
  | "Downloading"
  | "Ready"
  | "Failed"

/** The tracks a user can follow. Nightly exists server-side but is not offered yet. */
export const UpdateChannel = {
  Stable: "stable",
  Beta: "beta",
  Nightly: "nightly",
} as const

export type UpdateChannelName = (typeof UpdateChannel)[keyof typeof UpdateChannel]

/**
 * The whole updater state. Every endpoint and every push answers with one of these
 * rather than a delta, so a screen that has just mounted and one that has been open
 * all along render from the same object.
 */
export interface UpdateStatus {
  stage: UpdateStage
  /** The running build, informational version and all. */
  version: string
  channel: UpdateChannelName
  /** False for portable and unpackaged builds, which can only be pointed at a download. */
  supportsInAppApply: boolean
  /**
   * The running build is ahead of the selected channel, so that channel has nothing to
   * offer until it catches up. Not the same as being up to date, and worth saying so.
   */
  awaitingChannelCatchUp: boolean
  lastCheckedUtc: string | null
  availableVersion: string | null
  releaseNotesMarkdown: string | null
  /** 0 to 100, meaningful while the stage is Downloading. */
  downloadProgress: number
  /**
   * Whether the app may raise a toast about `availableVersion` on its own. False once the
   * user has answered "Later" or skipped it. The host decides, because the answer is
   * stored and outlives this window.
   */
  shouldPrompt: boolean
  /** The available version is skipped: it is still installable, it just stops asking. */
  skipped: boolean
  /** A code, not a sentence: the UI holds the wording. Null unless the stage is Failed. */
  error: string | null
}

/** The one-shot answer to "did this launch come out of an update?". */
export interface UpdateLaunchNotice {
  /** The version this build was updated into, on the first launch after it and only then. */
  updatedToVersion: string | null
}
