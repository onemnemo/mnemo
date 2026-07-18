import { useMemo } from "react"

import { useI18nStore } from "@/i18n/store"
import { createTranslate } from "@/i18n/translate"
import type { TranslateFn } from "@/i18n/types"

/**
 * Returns a translate function bound to the active bundle. Mirrors the desktop
 * app's T(key, ns): returns the key unchanged on a miss. Supports simple
 * {name}/{0} placeholder substitution.
 */
export function useT(): TranslateFn {
  const bundle = useI18nStore((s) => s.bundle)
  return useMemo(() => createTranslate(bundle), [bundle])
}
