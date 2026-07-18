import type { CardDto, StudyProgressDto, StudySessionDto } from "@/api/types"

// Pure view helpers for the study screen. Kept out of the components so the cloze rules and the
// panel-choice logic can be read - and corrected - without wading through JSX.

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

/** Filled width in px of the 160px progress track. */
export function progressFillWidth(progress: StudyProgressDto): number {
  if (progress.total <= 0) return 0
  return 160 * Math.min(Math.max(progress.completed / progress.total, 0), 1)
}

/**
 * Which end panel a finished session gets. Only a Review that had nothing scheduled is "caught
 * up"; a Cram with nothing in scope falls through to the ordinary completion screen, as it does
 * on the desktop.
 */
export function isAllCaughtUp(session: StudySessionDto): boolean {
  return session.startedEmpty && session.isFinished && session.mode === "review"
}

/** True while a card is on screen. False on the loading, complete and caught-up screens. */
export function isActive(session: StudySessionDto | null): boolean {
  return session?.current != null
}
