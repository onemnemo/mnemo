/**
 * Turning a window's practice totals into the three goal rows.
 *
 * Pure, because everything interesting here is arithmetic: which target applies, how far the bar
 * is filled, and which row comes first. The fetch that produces the totals has nothing to do with
 * any of it.
 */

/** A weekly window is seven daily targets, and seven daily windows of data. */
export const WEEK_DAYS = 7

export interface StudyGoalTotals {
  cards: number
  sessions: number
  minutes: number
}

/** What a day should reach, as the widget's own settings hold it. */
export interface StudyGoalTargets {
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
  /** Per day. A weekly window scales them by the week rather than asking for a second set. */
  targets: StudyGoalTargets
}

function goal(titleKey: string, completed: number, target: number): StudyGoal {
  // The bar is capped and the count is not. The desktop caps both, so 400 cards against a 350
  // target reads "350/350" and a good week looks exactly like a met one; capping only the bar
  // keeps the geometry sane without throwing away the number the user earned.
  return { titleKey, completed, target, percent: Math.min(100, (completed / target) * 100) }
}

/**
 * A target the arithmetic can divide by: a whole number of at least one. The config dialog never
 * writes less, but the settings bag is a stored string anyone can edit, and a zero would divide
 * every bar by nothing.
 */
function usable(target: number): number {
  return Number.isFinite(target) ? Math.max(1, Math.round(target)) : 1
}

export function buildStudyGoals(totals: StudyGoalTotals, options: StudyGoalOptions): StudyGoal[] {
  const scale = options.weekly ? WEEK_DAYS : 1
  const { targets } = options

  const cards = goal("CardsReviewed", totals.cards, usable(targets.cards) * scale)
  const sessions = goal("SessionsCompleted", totals.sessions, usable(targets.sessions) * scale)
  const minutes = goal("MinutesStudied", totals.minutes, usable(targets.minutes) * scale)

  return options.minutesFirst ? [minutes, cards, sessions] : [cards, sessions, minutes]
}
