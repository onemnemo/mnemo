import type { Group, Hit, HitKind, Scope } from "./types"

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * How well a hit answers a query.
 *
 * The gap between a word start and a mid-word match is the part that matters:
 * "cycle" should surface "The Krebs Cycle" ahead of anything that merely contains
 * those letters somewhere. Context and hidden keywords score low on purpose, so
 * they act as a safety net rather than as competition for real title matches.
 */
export function score(hit: Hit, needle: string): number {
  const title = hit.title.toLowerCase()
  if (title === needle) return 120
  if (title.startsWith(needle)) return 100
  if (new RegExp(`\\b${escapeRegex(needle)}`).test(title)) return 72
  if (title.includes(needle)) return 44
  if ((hit.context ?? "").toLowerCase().includes(needle)) return 24
  if ((hit.keywords ?? "").toLowerCase().includes(needle)) return 16
  return 0
}

/** Splits a title so the matched run can be marked without a regex in JSX. */
export function splitMatch(text: string, query: string): [string, string, string] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [text, "", ""]
  const at = text.toLowerCase().indexOf(needle)
  if (at === -1) return [text, "", ""]
  return [text.slice(0, at), text.slice(at, at + needle.length), text.slice(at + needle.length)]
}

export function scopeFor(char: string): Scope {
  if (char === ">") return "actions"
  if (char === "#") return "tags"
  return null
}

const ORDER: Array<{ kind: HitKind; label: string; cap: number }> = [
  { kind: "action", label: "Actions", cap: 5 },
  { kind: "note", label: "Notes", cap: 6 },
  { kind: "deck", label: "Decks", cap: 4 },
  { kind: "route", label: "Go to", cap: 4 },
]

export function runSearch(pool: Hit[], query: string, scope: Scope): Group[] {
  const needle = query.trim().toLowerCase()
  const actions = pool.filter((hit) => hit.kind === "action")

  if (scope === "tags") {
    const hits = pool
      .filter((hit) => hit.tags?.some((tag) => (needle ? tag.toLowerCase().includes(needle) : true)))
      .slice(0, 12)
    return hits.length ? [{ key: "tagged", label: "Tagged", hits }] : []
  }

  if (scope === "actions" && !needle) {
    return actions.length ? [{ key: "action", label: "Actions", hits: actions }] : []
  }
  if (!needle) return []

  const searched = scope === "actions" ? actions : pool
  const scored = searched
    .map((hit) => ({ hit, value: score(hit, needle) }))
    .filter((entry) => entry.value > 0)
    // Shorter titles break ties: of two equally good matches, the more specific
    // one is almost always the shorter.
    .sort((a, b) => b.value - a.value || a.hit.title.length - b.hit.title.length)

  const groups: Group[] = []
  for (const group of ORDER) {
    const hits = scored
      .filter((entry) => entry.hit.kind === group.kind)
      .slice(0, group.cap)
      .map((entry) => entry.hit)
    if (hits.length) groups.push({ key: group.kind, label: group.label, hits })
  }
  return groups
}

/** The screen before you type: what you were doing, and where you can go. */
export function defaultGroups(pool: Hit[], recent: Hit[]): Group[] {
  const routes = pool.filter((hit) => hit.kind === "route")
  const actions = pool.filter((hit) => hit.kind === "action").slice(0, 4)

  return [
    ...(recent.length ? [{ key: "recent", label: "Recent", hits: recent }] : []),
    ...(routes.length ? [{ key: "route", label: "Go to", hits: routes }] : []),
    ...(actions.length ? [{ key: "action", label: "Actions", hits: actions }] : []),
  ]
}
