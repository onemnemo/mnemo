/**
 * The updater row's rules. Every case here is one a user could be looking at when the
 * app is wrong about it: offering to restart into a build that was never downloaded,
 * calling a portable build updatable, or saying "up to date" to someone whose channel
 * has nothing to give them.
 */

import { describe, expect, it } from "vitest"

import { isUpdateWorking, nextUpdateAction, offersSkip, updateNote } from "./presentation"
import type { UpdateStatus } from "./types"

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

describe("nextUpdateAction", () => {
  it("offers a check before anything is known", () => {
    expect(nextUpdateAction(null)).toEqual({ kind: "check", label: "CheckNow" })
  })

  it.each(["Idle", "UpToDate", "Checking", "Downloading", "Failed"] as const)(
    "offers a check while the stage is %s",
    (stage) => {
      expect(nextUpdateAction(status({ stage })).kind).toBe("check")
    },
  )

  it("offers the download once an update is found", () => {
    expect(nextUpdateAction(status({ stage: "Available", availableVersion: "0.9.0" }))).toEqual({
      kind: "download",
      label: "DownloadUpdate",
    })
  })

  it("sends a build that cannot install itself to the releases page", () => {
    // Offering "Download" here would start something that cannot finish.
    expect(
      nextUpdateAction(status({ stage: "Available", availableVersion: "0.9.0", supportsInAppApply: false })),
    ).toEqual({ kind: "open-releases", label: "ViewOnGitHub" })
  })

  it("offers the restart only once the bytes are on disk", () => {
    expect(nextUpdateAction(status({ stage: "Ready", availableVersion: "0.9.0" }))).toEqual({
      kind: "apply",
      label: "RestartToUpdate",
    })
  })
})

describe("updateNote", () => {
  it("says nothing before anything is known", () => {
    expect(updateNote(null)).toBeNull()
  })

  it("says nothing at rest", () => {
    expect(updateNote(status({ stage: "Idle" }))).toBeNull()
  })

  it("names the version that is waiting", () => {
    expect(updateNote(status({ stage: "Available", availableVersion: "0.9.0" }))).toEqual({
      key: "UpdateAvailableVersionFormat",
      params: { 0: "0.9.0" },
    })
  })

  it("explains itself instead when the build cannot install one", () => {
    expect(updateNote(status({ stage: "Available", availableVersion: "0.9.0", supportsInAppApply: false }))).toEqual({
      key: "UpdateManualDownloadHint",
    })
  })

  it("reports progress while downloading", () => {
    expect(updateNote(status({ stage: "Downloading", downloadProgress: 42 }))).toEqual({
      key: "UpdateDownloadingFormat",
      params: { 0: "42" },
    })
  })

  it("tells a failed download apart from a failed check", () => {
    expect(updateNote(status({ stage: "Failed", error: "download_failed" }))).toEqual({ key: "UpdateDownloadFailed" })
    expect(updateNote(status({ stage: "Failed", error: "check_failed" }))).toEqual({ key: "UpdateCheckFailed" })
  })

  it("explains a channel that is behind rather than claiming to be up to date", () => {
    // The check genuinely found nothing, but "you have the newest version" would be a
    // lie to someone running a beta build who has just switched to Stable.
    expect(updateNote(status({ stage: "UpToDate", awaitingChannelCatchUp: true }))).toEqual({
      key: "UpdateChannelCatchUpNotice",
    })
  })
})

describe("isUpdateWorking", () => {
  it("is true while a request of ours is in flight", () => {
    expect(isUpdateWorking(status(), true)).toBe(true)
  })

  it.each(["Checking", "Downloading"] as const)("is true while the host is %s", (stage) => {
    // A download started before a reload is still running, and pressing again would
    // ask for it twice.
    expect(isUpdateWorking(status({ stage }), false)).toBe(true)
  })

  it.each(["Idle", "UpToDate", "Available", "Ready", "Failed"] as const)("is false while %s", (stage) => {
    expect(isUpdateWorking(status({ stage }), false)).toBe(false)
  })

  it("is false before anything is known, so the first check is pressable", () => {
    expect(isUpdateWorking(null, false)).toBe(false)
  })
})

describe("offersSkip", () => {
  it("offers to skip a found version", () => {
    expect(offersSkip(status({ stage: "Available", availableVersion: "0.9.0" }))).toBe(true)
  })

  it("keeps offering once it has been skipped, so the choice reads back", () => {
    // The button goes disabled rather than away: gone would be indistinguishable from
    // never offered.
    expect(offersSkip(status({ stage: "Available", availableVersion: "0.9.0", skipped: true }))).toBe(true)
  })

  it.each(["Idle", "Checking", "UpToDate", "Downloading", "Ready", "Failed"] as const)(
    "offers nothing to skip while %s",
    (stage) => {
      expect(offersSkip(status({ stage, availableVersion: "0.9.0" }))).toBe(false)
    },
  )

  it("offers nothing to skip when the stage says available but no version came with it", () => {
    expect(offersSkip(status({ stage: "Available" }))).toBe(false)
  })

  it("offers nothing before anything is known", () => {
    expect(offersSkip(null)).toBe(false)
  })
})
