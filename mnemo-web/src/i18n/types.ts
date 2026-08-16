// Mirrors the /api/i18n contracts (Mnemo.Host). The bundle is the merged
// namespace -> (key -> value) map the desktop app builds.
export type TranslationBundle = Record<string, Record<string, string>>

/** Mirrors Mnemo.Host/Contracts/LanguageDto.cs. */
export interface Language {
  code: string
  name: string
  nativeName: string
}

/** t("Sidebar", "Overview") with optional {name}/{0} substitution; returns the key on miss. */
export type TranslateFn = (ns: string, key: string, params?: Record<string, string | number>) => string
