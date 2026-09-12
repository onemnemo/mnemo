import { needsOnboarding } from "@/onboarding/first-run"
import { useSettingsStore } from "@/settings/store"
import type { SettingValue } from "@/settings/types"
import { UpdateChannel, type UpdateChannelName } from "@/updates/types"

/** The exact running version whose notice has been answered on this machine. */
export const BETA_NOTICE_SEEN_VERSION_KEY = "App.BetaNoticeSeenVersion"

interface SettingsSnapshot {
  values: Record<string, SettingValue>
  loaded: boolean
  failed: boolean
}

/** The running build as the updater reports it, or null while nothing has arrived. */
export interface RunningBuild {
  version: string
  runningChannel: UpdateChannelName
}

/**
 * Whether the beta notice is due.
 *
 * Once per exact version: a notice that opens on every launch is one people learn to dismiss
 * without reading, and "this build may have rough edges" is a claim about one build. The channel is
 * the host's reading of the running version rather than the track the user picked, because someone
 * following Stable who installed a beta by hand is running a beta all the same. First-time setup
 * owns the whole window, so the notice waits behind it, and a snapshot that could not be read says
 * nothing about what has been acknowledged.
 */
export function needsBetaNotice(settings: SettingsSnapshot, build: RunningBuild | null): boolean {
  if (!settings.loaded || settings.failed || needsOnboarding(settings)) return false
  if (!build || !build.version || build.runningChannel !== UpdateChannel.Beta) return false
  return settings.values[BETA_NOTICE_SEEN_VERSION_KEY] !== build.version
}

/** Records the version as answered. The write is optimistic and rolls back on failure. */
export function acknowledgeBetaNotice(version: string): Promise<void> {
  return useSettingsStore.getState().setValue(BETA_NOTICE_SEEN_VERSION_KEY, version)
}
