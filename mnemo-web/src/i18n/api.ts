import { apiFetch } from "@/api/client"
import type { Language, TranslationBundle } from "@/i18n/types"

export function fetchLanguages(): Promise<Language[]> {
  return apiFetch<Language[]>("/i18n/languages")
}

export function fetchBundle(culture: string): Promise<TranslationBundle> {
  return apiFetch<TranslationBundle>(`/i18n/${culture}`)
}
