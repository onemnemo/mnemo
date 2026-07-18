import { create } from "zustand"

import { useI18nStore } from "@/i18n/store"
import { createTranslate } from "@/i18n/translate"
import { toast } from "@/stores/toast"

import { fetchSettingValues, putSettingValue } from "./api"
import type { SettingValue } from "./types"

/**
 * The persisted settings the rows bind to.
 *
 * Loaded once as a snapshot rather than per row: the desktop reads each key
 * synchronously while constructing its view models, which has no equivalent across a
 * process boundary, and one request beats forty.
 *
 * Writes are optimistic and roll back on failure, so a switch never sits in a state
 * the database does not agree with.
 */
interface SettingsState {
  values: Record<string, SettingValue>
  /** Which write-only keys currently have a value stored. Secrets themselves never arrive. */
  secrets: Record<string, boolean>
  loaded: boolean

  load: () => Promise<void>
  setValue: (key: string, value: SettingValue) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  values: {},
  secrets: {},
  loaded: false,

  load: async () => {
    try {
      const snapshot = await fetchSettingValues()
      set({ values: snapshot.values, secrets: snapshot.secrets, loaded: true })
    } catch {
      // Render the schema's defaults rather than blocking the page; the first
      // successful write reconciles them.
      set({ loaded: true })
    }
  },

  setValue: async (key, value) => {
    const previous = get().values[key]
    const isSecret = key in get().secrets

    set((s) => ({
      values: isSecret ? s.values : { ...s.values, [key]: value },
      secrets: isSecret ? { ...s.secrets, [key]: typeof value === "string" && value.length > 0 } : s.secrets,
    }))

    try {
      await putSettingValue(key, value)
    } catch {
      set((s) => {
        const values = { ...s.values }
        if (previous === undefined) delete values[key]
        else values[key] = previous
        return { values }
      })

      const t = createTranslate(useI18nStore.getState().bundle)
      toast.warning(t("Common", "Error"))
    }
  },
}))

/** Reads one setting, falling back to the schema default while nothing is stored. */
export function useSettingValue<T extends SettingValue>(key: string, fallback: T): T {
  return useSettingsStore((s) => (s.values[key] as T | undefined) ?? fallback)
}

/** True when a write-only key currently has a value stored. */
export function useSecretIsSet(key: string): boolean {
  return useSettingsStore((s) => s.secrets[key] ?? false)
}

/** Non-reactive read, for callers outside React. */
export function getSettingValue<T extends SettingValue>(key: string, fallback: T): T {
  return (useSettingsStore.getState().values[key] as T | undefined) ?? fallback
}
