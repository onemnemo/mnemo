import type { Hit } from "./types"

/**
 * Actions the palette can run.
 *
 * Only things that actually work. A palette is a promise that what it lists is
 * real, and a row that opens a "not implemented" toast breaks that promise more
 * expensively than an absent row ever could. More arrive as their surfaces do.
 */
export const ACTIONS: Hit[] = [
  {
    id: "action:theme",
    kind: "action",
    title: "Toggle theme",
    context: "Light and dark",
    icon: "moon",
    keywords: "dark light appearance colour color",
    run: (ctx) => ctx.toggleTheme(),
  },
  {
    id: "action:sidebar",
    kind: "action",
    title: "Toggle sidebar",
    icon: "panel-left",
    keywords: "collapse expand rail hide",
    run: (ctx) => ctx.toggleSidebar(),
  },
]
