/**
 * The shape of first-run setup.
 *
 * What makes this flow different from most onboarding is what it is not allowed to ask.
 * Mnemo has no server, no account and no analytics, so a question with no consumer is a
 * question asked to seem attentive. Only three survive that filter: the name, which
 * cannot be guessed; the theme, which is the most visible decision in the product and
 * whose picker is its own preview; and the language, which is guessed already but is
 * expensive to guess wrong. The bookends are statements, not questions.
 */
export type OnboardingStep = "welcome" | "you" | "look" | "lang" | "done"

export const ORDER: readonly OnboardingStep[] = ["welcome", "you", "look", "lang", "done"]

/** The steps that ask something. Only these get a footer and a progress dot. */
export const QUESTIONS: readonly OnboardingStep[] = ["you", "look", "lang"]

export function isQuestion(step: OnboardingStep): boolean {
  return QUESTIONS.includes(step)
}

/** Position among the questions, or -1 for the bookends. */
export function questionIndex(step: OnboardingStep): number {
  return QUESTIONS.indexOf(step)
}

export function nextStep(step: OnboardingStep): OnboardingStep | null {
  return ORDER[ORDER.indexOf(step) + 1] ?? null
}

export function previousStep(step: OnboardingStep): OnboardingStep | null {
  const at = ORDER.indexOf(step)
  return at > 0 ? (ORDER[at - 1] ?? null) : null
}

/**
 * Whether a progress dot navigates. Backwards only: a dot that jumps forward past a
 * question is a dot that skips it without saying so.
 */
export function canJumpTo(target: OnboardingStep, from: OnboardingStep): boolean {
  const at = questionIndex(from)
  const to = questionIndex(target)
  return to !== -1 && at !== -1 && to < at
}
