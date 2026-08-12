import { useSettingsStore } from "@/settings/store"
import type { SettingValue } from "@/settings/types"

export const ONBOARDING_COMPLETED_KEY = "Onboarding.Completed"

interface SettingsSnapshot {
  values: Record<string, SettingValue>
  loaded: boolean
  failed: boolean
}

/**
 * Whether to run first-time setup.
 *
 * Deliberately requires a successful load. Onboarding that reappears after completion is
 * worse than onboarding that never appears, and a snapshot that could not be read is not
 * evidence of a fresh install: without the `failed` check every launch after a failed
 * read would walk an existing user through setup again.
 */
export function needsOnboarding(snapshot: SettingsSnapshot): boolean {
  return snapshot.loaded && !snapshot.failed && snapshot.values[ONBOARDING_COMPLETED_KEY] !== true
}

export function useNeedsFirstRun(): boolean {
  return useSettingsStore(needsOnboarding)
}

/**
 * The single exit from setup, taken by finishing and by skipping alike. Skipping means
 * the defaults are fine, not ask me again next launch, so it records completion too.
 */
export function completeOnboarding(): Promise<void> {
  return useSettingsStore.getState().setValue(ONBOARDING_COMPLETED_KEY, true)
}
