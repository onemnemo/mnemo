/**
 * The version as a reader should see it.
 *
 * The host reports the informational version, which carries SemVer build metadata
 * after a `+` — for this build, the full commit hash. That is meaningful to a build
 * system and noise to a person, so it is dropped for display only; the value used for
 * update comparisons stays whole.
 */
export function formatVersion(version: string | undefined): string {
  if (!version) return "…"
  const plus = version.indexOf("+")
  return plus === -1 ? version : version.slice(0, plus)
}
