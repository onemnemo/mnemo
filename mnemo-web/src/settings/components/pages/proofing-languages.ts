import type { ProofingLanguage } from "@/notes/proofing/types"

/**
 * The scope select's value for a word that belongs to no single language.
 *
 * A Radix item cannot carry an empty value, and a star is not legal in a
 * language tag, so this can never collide with a scope a word already stores.
 */
export const ANY_LANGUAGE = "*"

/**
 * A language's name, with the region appended only when that is what tells two
 * entries apart.
 *
 * Every call site passes the whole catalogue, so one language reads the same in
 * the active list as it does in the picker. Four rows reading "English" is the
 * failure the region is there to prevent; carrying it on the only Spanish there
 * is says nothing.
 */
export function labelOf(language: ProofingLanguage, pool: readonly ProofingLanguage[]): string {
  if (language.region.length === 0) return language.name
  const shared = pool.some((other) => other.id !== language.id && other.name === language.name)
  return shared ? `${language.name} (${language.region})` : language.name
}

/**
 * What a dictionary is doing, in one line.
 *
 * An absent one answers with the host's own reason key. It is rendered only
 * when this build ships a translation for it: a key that does not resolve
 * renders as the key itself, which reads as a bug to every user who sees it.
 *
 * Those three reasons sit in the Settings namespace under the dotted names the
 * catalogue emits (`proofing.language.filesMissing` and the two beside it)
 * rather than the PascalCase the rest of that namespace uses, because the host
 * chose the names and the web can only look them up by the name it is handed.
 */
export function describeState(
  language: ProofingLanguage,
  st: (key: string) => string,
  shipped: (key: string) => boolean,
): string {
  if (language.state === "ready") return st("ProofingStateReady")
  if (language.state === "loading") return st("ProofingStateLoading")
  if (language.reasonKey && shipped(language.reasonKey)) return st(language.reasonKey)
  return st("ProofingStateAbsent")
}

/** The active set with one entry moved a place. Unchanged when the move runs off an end. */
export function moveLanguage(active: readonly string[], id: string, delta: number): readonly string[] {
  const at = active.indexOf(id)
  const to = at + delta
  if (at < 0 || to < 0 || to >= active.length) return active
  const next = [...active]
  next.splice(at, 1)
  next.splice(to, 0, id)
  return next
}

export function withoutLanguage(active: readonly string[], id: string): readonly string[] {
  return active.filter((entry) => entry !== id)
}

/**
 * Appended rather than inserted at the front: the first entry is the one that
 * suggests first, and adding a second language is not a claim about whose
 * corrections should be offered.
 */
export function withLanguage(active: readonly string[], id: string): readonly string[] {
  return active.includes(id) ? active : [...active, id]
}

export interface PickerEntry {
  readonly language: ProofingLanguage
  /** Already in the active set, so the row reports rather than offers. */
  readonly active: boolean
}

export interface PickerGroups {
  /** Installed on this machine, switched on or not. */
  readonly installed: readonly PickerEntry[]
  /** Nothing here to switch on, so the row states the reason and offers no button. */
  readonly unavailable: readonly ProofingLanguage[]
}

export function pickerGroups(
  languages: readonly ProofingLanguage[],
  active: readonly string[],
): PickerGroups {
  return {
    installed: languages
      .filter((language) => language.installed)
      .map((language) => ({ language, active: active.includes(language.id) })),
    unavailable: languages.filter((language) => !language.installed),
  }
}

/**
 * Which of the offered scopes a word is sitting on.
 *
 * A word seeded from the older editor setting carries a bare code such as `en`
 * rather than a catalogue id, and the host decides whether a scoped word applies
 * to a language by comparing primary subtags, so on a machine with `en-US`
 * installed a word scoped to `en` is scoped to that dictionary. Naming it any
 * other way would put two options reading "English" in one list.
 *
 * Only a scope no installed language answers for stays as it is stored, and it
 * is then an option of its own so the word's value is still one of them.
 */
export function resolveScope(stored: string | null, languages: readonly ProofingLanguage[]): string {
  if (stored === null) return ANY_LANGUAGE
  const offered = languages.filter((language) => language.installed)
  // The word's own id wins over a relative of it, or a machine carrying both
  // en-GB and en-US would move an en-US word onto whichever came first.
  const exact = offered.find((language) => language.id === stored)
  if (exact) return exact.id
  const primary = primarySubtag(stored)
  const related = offered.find((language) => primarySubtag(language.id) === primary)
  return related ? related.id : stored
}

/**
 * The scopes one word's select may offer: no language, every installed
 * language, and nothing else unless the word is stored under a scope none of
 * them answers for.
 */
export function scopeValues(
  stored: string | null,
  languages: readonly ProofingLanguage[],
): readonly string[] {
  const values = [ANY_LANGUAGE]
  for (const language of languages) {
    if (language.installed && !values.includes(language.id)) values.push(language.id)
  }
  const current = resolveScope(stored, languages)
  if (!values.includes(current)) values.push(current)
  return values
}

/**
 * An add and the removal that follows it, or nothing when the choice is the one
 * already shown.
 *
 * The order is the point. The host has no way to move a word, so a scope change
 * is two calls and a failure can land between them. Adding first leaves the word
 * under both scopes until the next change; removing first loses it outright.
 */
export interface ScopeChange {
  /** The string the word is stored under. A removal matches it exactly, so it goes back as it stands. */
  readonly from: string | null
  readonly to: string | null
}

/**
 * What picking a scope has to do.
 *
 * Nothing when the pick is the option the row already shows: a word stored as
 * `en` is shown on `en-US`, and rewriting it to that would move the stored
 * string without changing anything the user can see. That is also what keeps the
 * two scopes distinct, so the removal cannot take the row the add just made.
 */
export function scopeChange(
  stored: string | null,
  chosen: string,
  languages: readonly ProofingLanguage[],
): ScopeChange | null {
  if (chosen === resolveScope(stored, languages)) return null
  return { from: stored, to: chosen === ANY_LANGUAGE ? null : chosen }
}

/**
 * A stored scope's name. A code with no catalogue entry of its own is named by
 * its primary subtag, which is also how the host decides whether a scoped word
 * applies to a language. That comparison ignores case, because a scope carried
 * over from the older setting was never canonicalised.
 */
export function scopeLabel(scope: string, languages: readonly ProofingLanguage[]): string {
  const exact = languages.find((language) => language.id === scope)
  if (exact) return labelOf(exact, languages)
  const primary = primarySubtag(scope)
  const related = languages.find((language) => primarySubtag(language.id) === primary)
  return related ? labelOf(related, languages) : scope
}

function primarySubtag(id: string): string {
  const cut = id.indexOf("-")
  return (cut < 0 ? id : id.slice(0, cut)).toLowerCase()
}
