import type { CardDto } from "@/api/types"

// What the review, cram and test screens all need to know about showing a card. Kept out of the
// components so the cloze rules can be read - and corrected - without wading through JSX, and out
// of either screen so neither owns rules the other also depends on.

/**
 * Matches one cloze deletion, e.g. `{{c1::mitochondria}}`. Non-greedy so adjacent deletions stay
 * separate, and `[\s\S]` rather than `.` because a deletion may span lines - the C# original uses
 * RegexOptions.Singleline for the same reason.
 */
const CLOZE = /\{\{c\d+::([\s\S]*?)\}\}/g

/** Front of a cloze card: every deletion becomes a placeholder, whatever its ordinal. */
export function maskCloze(front: string): string {
  return front.replace(CLOZE, "[…]")
}

/** Answer side of a cloze card: the deletions come back in bold. The card's back is never shown. */
export function revealCloze(front: string): string {
  return front.replace(CLOZE, "**$1**")
}

/** What the card's front shows before the answer is revealed. */
export function promptText(card: CardDto): string {
  return card.type === "cloze" ? maskCloze(card.front) : card.front
}

/** What the answer half shows. For cloze that is the front again, deletions filled in. */
export function answerText(card: CardDto): string {
  return card.type === "cloze" ? revealCloze(card.front) : card.back
}

/** Filled width in px of the 160px progress track both session bars draw. */
export function progressFillWidth(completed: number, total: number): number {
  if (total <= 0) return 0
  return 160 * Math.min(Math.max(completed / total, 0), 1)
}
