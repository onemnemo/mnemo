import type { TranslateFn } from "@/i18n/types"
import type { Hit } from "./types"

/**
 * Actions the palette can run.
 *
 * Only things that actually work. A palette is a promise that what it lists is
 * real, and a row that opens a "not implemented" toast breaks that promise more
 * expensively than an absent row ever could. More arrive as their surfaces do.
 *
 * A function rather than a constant: the titles are translated, and translating
 * needs the active bundle, which only exists inside a component via useT().
 */
export function getActions(t: TranslateFn): Hit[] {
  return [
    {
      id: "action:theme",
      kind: "action",
      title: t("GlobalSearch", "ActionToggleTheme"),
      context: t("GlobalSearch", "ActionToggleThemeContext"),
      icon: "moon",
      keywords: "dark light appearance colour color",
      run: (ctx) => ctx.toggleTheme(),
    },
    {
      id: "action:sidebar",
      kind: "action",
      title: t("GlobalSearch", "ActionToggleSidebar"),
      icon: "panel-left",
      keywords: "collapse expand rail hide",
      run: (ctx) => ctx.toggleSidebar(),
    },
  ]
}
