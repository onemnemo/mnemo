import type { TranslateFn, TranslationBundle } from "./types"

/**
 * Builds a translate function over a bundle. Mirrors the desktop's T(key, ns):
 * returns the key unchanged on a miss, and supports simple {name}/{0} placeholder
 * substitution. Shared by the useT hook (React) and stores that translate outside
 * of React (e.g. the chat turn flow).
 */
export function createTranslate(bundle: TranslationBundle): TranslateFn {
  return (ns, key, params) => {
    const value = bundle[ns]?.[key]
    if (value === undefined) return key
    if (!params) return value
    return value.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
  }
}
