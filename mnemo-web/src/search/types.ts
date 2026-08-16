/** Everything the palette can find. Kinds are also the grouping, in the order in ORDER. */
export type HitKind = "action" | "note" | "deck" | "route"

export interface Hit {
  id: string
  kind: HitKind
  title: string
  /** The line under the title: where the thing lives, or what it does. */
  context?: string
  icon?: string
  /** Where choosing it goes. Hits with a `run` do something instead. */
  href?: string
  run?: (ctx: ActionContext) => void
  /** Extra words that should match without being displayed. */
  keywords?: string
  /** Tags, for the `#` scope. */
  tags?: string[]
}

/** What an action is allowed to reach. Passed in so the index stays free of store imports. */
export interface ActionContext {
  navigate: (href: string) => void
  toggleTheme: () => void
  toggleSidebar: () => void
  askSoma: (question: string) => void
}

/**
 * Typing `>` or `#` turns the prefix into a chip and narrows the search. Nothing
 * about the palette requires knowing them, and knowing them makes it twice as fast.
 */
export type Scope = null | "actions" | "tags"

export interface Group {
  key: string
  label: string
  hits: Hit[]
}
