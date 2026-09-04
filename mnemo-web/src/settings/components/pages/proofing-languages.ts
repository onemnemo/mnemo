import type { ProofingLanguage } from "@/notes/proofing/types"

/**
 * What the language picker may offer.
 *
 * Installed, not ready. A dictionary is loaded when something asks a question
 * in it, and the host warms only the language already in force, so a second
 * bundled language sits at "loading" until it is selected. Offering only ready
 * ones made that unreachable: it had to be ready to be picked and picked to
 * become ready. The host accepts any installed language on write, so the state
 * is a hint to show, not a gate. Absent languages carry nothing to load and are
 * left out.
 */
export function languageChoices(
  languages: readonly ProofingLanguage[],
  loadingHint: string,
): { value: string; label: string }[] {
  return languages
    .filter((language) => language.installed)
    .map((language) => ({
      value: language.id,
      label: language.state === "ready" ? labelOf(language) : `${labelOf(language)} (${loadingHint})`,
    }))
}

/** The region is only worth showing when it is what tells two entries apart. */
export function labelOf(language: ProofingLanguage): string {
  return language.region.length > 0 ? `${language.name} (${language.region})` : language.name
}
