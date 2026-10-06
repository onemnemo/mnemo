import { formatCount, pluralKey } from "@/i18n/plural"
import { useI18nStore } from "@/i18n/store"
import type { TranslateFn } from "@/i18n/types"

/** Masks named in the confirm; the rest are counted. */
export const NAMED_LIMIT = 3

/**
 * The body of the confirm shown when a save moves cards to the trash. Names up to three masks,
 * counts the others (unlabelled ones included) and says how many cards stay as they are.
 */
export function removalMessage(
  t: TranslateFn,
  removed: readonly { label?: string }[],
  kept: number,
  locale: string = useI18nStore.getState().language,
): string {
  const text = (one: string, many: string, count: number, params: Record<string, string | number> = {}) =>
    t("Flashcards", pluralKey({ one, many }, count, locale), { ...params, count: formatCount(count, locale) })

  const names = removed
    .map((card) => card.label?.trim() ?? "")
    .filter((label) => label.length > 0)
    .slice(0, NAMED_LIMIT)
  const more = removed.length - names.length

  let head: string
  if (names.length === 0) {
    head = text("OcclusionRemoveUnnamedOne", "OcclusionRemoveUnnamedMany", removed.length)
  } else {
    const items = more > 0 ? [...names, text("OcclusionRemoveMoreOne", "OcclusionRemoveMoreMany", more)] : names
    const list = new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(items)
    head = text("OcclusionRemoveNamedOne", "OcclusionRemoveNamedMany", removed.length, { names: list })
  }

  return kept > 0 ? `${head} ${text("OcclusionRemoveKeepOne", "OcclusionRemoveKeepMany", kept)}` : head
}
