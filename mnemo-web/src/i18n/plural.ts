import { useI18nStore } from "@/i18n/store"
import type { TranslateFn } from "@/i18n/types"

/**
 * A count-bearing string as two literal keys. Languages with one form (Japanese) repeat the
 * same text under both.
 */
export interface PluralKeys {
  one: string
  many: string
}

const rulesByLocale = new Map<string, Intl.PluralRules>()

function rulesFor(locale: string): Intl.PluralRules {
  let rules = rulesByLocale.get(locale)
  if (!rules) {
    try {
      rules = new Intl.PluralRules(locale)
    } catch {
      rules = new Intl.PluralRules("en")
    }
    rulesByLocale.set(locale, rules)
  }
  return rules
}

/**
 * Which of the pair a count takes in `locale` (the active UI language when omitted). Only the
 * CLDR "one" category reads the one key; every other category, zero included, reads many.
 */
export function pluralKey(keys: PluralKeys, count: number, locale?: string): string {
  const category = rulesFor(locale ?? useI18nStore.getState().language).select(count)
  return category === "one" ? keys.one : keys.many
}

const formatsByLocale = new Map<string, Intl.NumberFormat>()

/** A count written the way `locale` (the active UI language when omitted) groups its digits. */
export function formatCount(count: number, locale?: string): string {
  const tag = locale ?? useI18nStore.getState().language
  let format = formatsByLocale.get(tag)
  if (!format) {
    try {
      format = new Intl.NumberFormat(tag)
    } catch {
      format = new Intl.NumberFormat("en")
    }
    formatsByLocale.set(tag, format)
  }
  return format.format(count)
}

/** Translates the form `count` takes, with `{count}` filled in beside any other params; the count wins a clash. */
export function tPlural(
  t: TranslateFn,
  ns: string,
  keys: PluralKeys,
  count: number,
  params?: Record<string, string | number>,
  locale?: string,
): string {
  return t(ns, pluralKey(keys, count, locale), { ...params, count: formatCount(count, locale) })
}
