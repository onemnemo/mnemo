import { pluralKey } from "@/i18n/plural"
import type { TranslateFn } from "@/i18n/types"

import type { CardEntry } from "./cards"

/**
 * The accessible name of a mask: its card number, its own label when it has one, and how many masks
 * its group holds, for example "Mask 4, Rough ER, group of 2".
 */
export function maskName(t: TranslateFn, card: Pick<CardEntry, "number" | "label" | "ids" | "grouped">): string {
  const join = (name: string, detail: string) => t("Flashcards", "OcclusionMaskDetail", { name, detail })

  let name = t("Flashcards", "OcclusionMask", { number: card.number })
  if (card.label) name = join(name, card.label)
  if (card.grouped) {
    const count = card.ids.length
    const key = pluralKey({ one: "OcclusionGroupOfOne", many: "OcclusionGroupOfMany" }, count)
    name = join(name, t("Flashcards", key, { count }))
  }
  return name
}
