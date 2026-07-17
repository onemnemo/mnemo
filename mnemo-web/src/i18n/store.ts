import { create } from "zustand"

import { putLanguage } from "@/api/settings"
import { fetchBundle } from "@/i18n/api"
import type { TranslationBundle } from "@/i18n/types"

export const DEFAULT_LANGUAGE = "en"

interface I18nState {
  language: string
  bundle: TranslationBundle
  ready: boolean
  /** Load a language's bundle without changing the persisted preference (startup). */
  load: (code: string) => Promise<void>
  /** Change the active language and persist it to backend settings. */
  setLanguage: (code: string) => Promise<void>
}

async function applyBundle(set: (partial: Partial<I18nState>) => void, code: string): Promise<void> {
  try {
    const bundle = await fetchBundle(code)
    set({ language: code, bundle, ready: true })
  } catch {
    // Never leave the app un-rendered: fall back to key-on-miss with an empty bundle.
    set({ language: code, ready: true })
  }
}

export const useI18nStore = create<I18nState>((set) => ({
  language: DEFAULT_LANGUAGE,
  bundle: {},
  ready: false,
  load: (code) => applyBundle(set, code),
  setLanguage: async (code) => {
    await applyBundle(set, code)
    // Persist after the switch so the UI updates immediately; the write is durable
    // background work shared with the desktop app (App.Language).
    void putLanguage(code)
  },
}))
