import { create } from "zustand"

import { useI18nStore } from "@/i18n/store"
import { createTranslate } from "@/i18n/translate"
import { fetchNav } from "@/nav/api"
import { useNavStore } from "@/nav/store"
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
  /** A load has finished, successfully or not. */
  loaded: boolean
  /** The last load failed, so `values` holds nothing rather than the stored state. */
  failed: boolean

  load: () => Promise<void>
  setValue: (key: string, value: SettingValue) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  values: {},
  secrets: {},
  loaded: false,
  failed: false,

  load: async () => {
    try {
      const snapshot = await fetchSettingValues()
      set({ values: snapshot.values, secrets: snapshot.secrets, loaded: true, failed: false })
    } catch {
      // Render the schema's defaults rather than blocking the page; the first
      // successful write reconciles them.
      set({ loaded: true, failed: true })
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
      // Any setting can gate a nav item's visibility server-side (the nav endpoint
      // recomputes it live), so the sidebar has to reread the nav model after every
      // successful write, not just the ones known to affect it today. A stale sidebar
      // otherwise looks broken until the app restarts.
      void fetchNav()
        .then((nav) => useNavStore.getState().setCategories(nav))
        .catch(() => {})
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

/**
 * The base type behind a literal fallback. Without it `useSettingValue(key, "")` reads
 * back as the type `""` rather than `string`, since the fallback is what the type
 * parameter is inferred from.
 */
type Widen<T> = T extends string ? string : T extends boolean ? boolean : T

/** Reads one setting, falling back to the schema default while nothing is stored. */
export function useSettingValue<T extends SettingValue>(key: string, fallback: T): Widen<T> {
  return useSettingsStore((s) => (s.values[key] as Widen<T> | undefined) ?? (fallback as Widen<T>))
}

/** True when a write-only key currently has a value stored. */
export function useSecretIsSet(key: string): boolean {
  return useSettingsStore((s) => s.secrets[key] ?? false)
}

/** Non-reactive read, for callers outside React. */
export function getSettingValue<T extends SettingValue>(key: string, fallback: T): Widen<T> {
  return (useSettingsStore.getState().values[key] as Widen<T> | undefined) ?? (fallback as Widen<T>)
}
