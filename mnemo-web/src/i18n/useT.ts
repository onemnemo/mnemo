import { useCallback } from "react"

import { useI18nStore } from "@/i18n/store"
import type { TranslateFn } from "@/i18n/types"

/**
 * Returns a translate function bound to the active bundle. Mirrors the desktop
 * app's T(key, ns): returns the key unchanged on a miss. Supports simple
 * {name}/{0} placeholder substitution.
 */
export function useT(): TranslateFn {
  const bundle = useI18nStore((s) => s.bundle)

  return useCallback<TranslateFn>(
    (ns, key, params) => {
      const value = bundle[ns]?.[key]
      if (value === undefined) return key
      if (!params) return value
      return value.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
    },
    [bundle],
  )
}
