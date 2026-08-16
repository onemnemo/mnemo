/**
 * Turning a window's practice totals into the three goal rows.
 *
 * Pure, because everything interesting here is arithmetic the two apps have to agree on: which
 * target applies, how far the bar is filled, and which row comes first. The fetch that produces
 * the totals has nothing to do with any of it.
 */

/**
 * Targets for a single day. Hard-coded, exactly as on the desktop: there is no setting for them
 * on either side, and inventing one here would make a board configured in the port unreadable in
 * the app it is meant to match. That they cannot be changed at all is a product gap, not an
 * oversight of this port.
 */
const DAILY_TARGETS = { cards: 50, sessions: 3, minutes: 30 } as const

/** A weekly window is seven daily targets, and seven daily windows of data. */
export const WEEK_DAYS = 7

export interface StudyGoalTotals {
  cards: number
  sessions: number
  minutes: number
}

export interface StudyGoal {
  /** Resolved against the StudyGoals namespace by the view; the arithmetic never sees a string. */
  titleKey: string
  /** What the user actually did, uncapped. */
  completed: number
  target: number
  /** How full the bar is drawn, 0 to 100. Capped where {@link completed} is not. */
  percent: number
}

export interface StudyGoalOptions {
  weekly: boolean
  /** The configured metric leads the list, so the goal the user cares about is the top row. */
  minutesFirst: boolean
}

function goal(titleKey: string, completed: number, target: number): StudyGoal {
  // The bar is capped and the count is not. The desktop caps both, so 400 cards against a 350
  // target reads "350/350" and a good week looks exactly like a met one; capping only the bar
  // keeps the geometry sane without throwing away the number the user earned.
  return { titleKey, completed, target, percent: Math.min(100, (completed / target) * 100) }
}

export function buildStudyGoals(totals: StudyGoalTotals, options: StudyGoalOptions): StudyGoal[] {
  const scale = options.weekly ? WEEK_DAYS : 1

  const cards = goal("CardsReviewed", totals.cards, DAILY_TARGETS.cards * scale)
  const sessions = goal("SessionsCompleted", totals.sessions, DAILY_TARGETS.sessions * scale)
  const minutes = goal("MinutesStudied", totals.minutes, DAILY_TARGETS.minutes * scale)

  return options.minutesFirst ? [minutes, cards, sessions] : [cards, sessions, minutes]
}
