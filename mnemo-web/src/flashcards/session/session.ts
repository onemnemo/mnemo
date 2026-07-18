import type { StudyProgressDto, StudySessionDto } from "@/api/types"

import { progressFillWidth } from "../study"

// Pure view helpers for the review and cram screen. The card-text and progress-bar rules it
// shares with the test screen live in ../study; what is left here is what only a session has.

/** Filled width in px of the progress track, from the session's own progress shape. */
export function sessionFillWidth(progress: StudyProgressDto): number {
  return progressFillWidth(progress.completed, progress.total)
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
