import { create } from "zustand"

import { fetchBundle } from "@/i18n/api"
import type { TranslationBundle } from "@/i18n/types"

export const DEFAULT_LANGUAGE = "en"

// Interim persistence, like the theme: the desktop app stores the language in
// backend settings, which is where this belongs eventually.
const STORAGE_KEY = "mnemo.language"

function readStoredLanguage(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_LANGUAGE
  } catch {
    return DEFAULT_LANGUAGE
  }
}

interface I18nState {
  language: string
  bundle: TranslationBundle
  ready: boolean
  /** Load a language's bundle without changing the persisted preference (startup). */
  load: (code: string) => Promise<void>
  /** Change and persist the active language. */
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
  language: readStoredLanguage(),
  bundle: {},
  ready: false,
  load: (code) => applyBundle(set, code),
  setLanguage: async (code) => {
    try {
      localStorage.setItem(STORAGE_KEY, code)
    } catch {
      // Non-fatal.
    }
    await applyBundle(set, code)
  },
}))
