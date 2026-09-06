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

/**
 * Reads whatever deletions a piece of text still carries back out, in bold.
 *
 * Whitespace the writer happened to select stays outside the markers. A marker with a space on
 * the inside is not formatting, so `** Tokyo **` would reach the card as four literal asterisks.
 */
export function revealCloze(text: string): string {
  return text.replace(CLOZE, (_match, inner: string) => {
    const spans = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)
    if (!spans || !spans[2]) return inner
    return `${spans[1]}**${spans[2]}**${spans[3]}`
  })
}

/**
 * What the card's front shows before the answer is revealed.
 *
 * Generation already masks the front it stores, so this changes nothing on most cards. It stays
 * for the ones generation could not read: a deletion written across a line break is left in the
 * row as literal markup, and masking here is what keeps it off the screen.
 */
export function promptText(card: CardDto): string {
  return card.type === "cloze" ? maskCloze(card.front) : card.front
}

/**
 * What the answer half shows.
 *
 * A cloze card's back is the sentence with its deletion filled in, written out when the card was
 * generated, so the answer is read from there. Deriving it from the front instead showed the
 * masked sentence twice and never the answer: the stored front has no markers left to reveal.
 */
export function answerText(card: CardDto): string {
  if (card.type !== "cloze") return card.back
  return card.back.trim() ? revealCloze(card.back) : revealCloze(card.front)
}

/** Filled width in px of the 160px progress track both session bars draw. */
export function progressFillWidth(completed: number, total: number): number {
  if (total <= 0) return 0
  return 160 * Math.min(Math.max(completed / total, 0), 1)
}
