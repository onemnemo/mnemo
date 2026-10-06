import type { CardDto, OcclusionDto } from "@/api/types"
import { pluralKey } from "@/i18n/plural"
import type { TranslateFn } from "@/i18n/types"
import { useT } from "@/i18n/useT"

import { askedMasks, cardNumber, imageName } from "./card"

/**
 * The accessible name of the review image: the card, how many areas it asks and, once revealed,
 * the answer. The name is data, so a screen reader hears the question rather than "image".
 */
export function stageLabel(
  t: TranslateFn,
  args: { name: string; number: number; asked: number; answer: string | null },
): string {
  const params = { name: args.name, number: args.number, count: args.asked }
  if (args.answer !== null) return t("Flashcards", "StudyOcclusionAnswer", { ...params, label: args.answer })

  const key = pluralKey({ one: "StudyOcclusionImageOne", many: "StudyOcclusionImageMany" }, args.asked)
  return t("Flashcards", key, params)
}

/** The accessible name for a card's image, from its question, the masks it asks and whether it is revealed. */
export function useStageLabel(card: CardDto, occlusion: OcclusionDto, revealed: boolean): string {
  const t = useT()
  return stageLabel(t, {
    name: imageName(card.front, t("Flashcards", "CardTypeOcclusion")),
    number: cardNumber(occlusion),
    asked: Math.max(1, askedMasks(occlusion).length),
    answer: revealed ? card.back.trim() || t("Flashcards", "OcclusionNoLabel") : null,
  })
}
