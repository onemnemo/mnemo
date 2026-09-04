/**
 * The peek's tier, in both directions.
 *
 * Asserting it against `Z_LAYERS` alone would prove nothing: the surfaces an overlaying
 * panel could paint over, and the menus that have to paint over it, are all raw `z-[N]`
 * literals in their own files. So the literals are read out of those files, and this
 * fails the day one of them moves.
 *
 * The direction that is not obvious is the one above. Every menu in the app portals to the
 * body, so it compares against the whole app from the root stacking context, and the panel
 * used to win: the peek painted over the tab menu, the tree row menu, and its own options
 * menu, which opens inside its own rectangle over an opaque background.
 */

import { describe, expect, it } from "vitest"

import { readRepoText } from "@/i18n/test-bundle"
import { Z_LAYERS } from "@/lib/z-layers"

/**
 * Every distinct z tier in a file, arbitrary or plain, so a menu quietly put back on a
 * stock Tailwind step reads as the wrong tier rather than as no tier at all.
 */
function zLayers(...segments: string[]): number[] {
  const source = readRepoText("mnemo-web", "src", ...segments)
  const found = [...source.matchAll(/z-(?:\[(\d+)\]|(\d+))(?![\w[-])/g)]
  return [...new Set(found.map((match) => Number(match[1] ?? match[2])))]
}

/** The one tier in a file, so a second one added later is a failure rather than a guess. */
function soleZLayer(...segments: string[]): number {
  const distinct = zLayers(...segments)
  expect(distinct, `expected exactly one z tier in ${segments.join("/")}`).toHaveLength(1)
  return distinct[0]
}

describe("what has to paint over the side peek", () => {
  // One shared class behind the click-triggered flyout and the right-click variant, so
  // both menu families move together.
  it("puts the shared menu surface above the panel", () => {
    expect(soleZLayer("components", "ui", "menu-styles.ts")).toBe(Z_LAYERS.menu)
    expect(Z_LAYERS.menu).toBeGreaterThan(Z_LAYERS.peek)
  })

  it("puts popovers on the same tier as menus", () => {
    expect(soleZLayer("components", "ui", "popover.tsx")).toBe(Z_LAYERS.menu)
  })

  it("leaves menus below everything they were already below", () => {
    expect(Z_LAYERS.menu).toBeLessThan(soleZLayer("components", "shell", "chrome", "ResizeEdges.tsx"))
    for (const tier of [Z_LAYERS.onboarding, Z_LAYERS.modal, Z_LAYERS.toast, Z_LAYERS.dialog]) {
      expect(Z_LAYERS.menu).toBeLessThan(tier)
    }
    expect(Z_LAYERS.menu).toBeLessThan(
      Math.min(...zLayers("components", "shell", "palette", "CommandPalette.tsx")),
    )
    expect(Z_LAYERS.menu).toBeLessThan(soleZLayer("components", "ui", "tooltip", "TooltipHost.tsx"))
  })
})

describe("the side peek's stacking tier", () => {
  it("sits below the window resize edges", () => {
    expect(soleZLayer("components", "shell", "chrome", "ResizeEdges.tsx")).toBe(100)
    expect(Z_LAYERS.peek).toBeLessThan(100)
  })

  it("sits below the command palette", () => {
    const tiers = zLayers("components", "shell", "palette", "CommandPalette.tsx")
    expect(tiers).toContain(160)
    expect(Z_LAYERS.peek).toBeLessThan(Math.min(...tiers))
  })

  it("sits below tooltips", () => {
    expect(soleZLayer("components", "ui", "tooltip", "TooltipHost.tsx")).toBe(300)
    expect(Z_LAYERS.peek).toBeLessThan(300)
  })

  it("sits below onboarding, the modals, the toasts and the dialogs", () => {
    for (const tier of [Z_LAYERS.onboarding, Z_LAYERS.modal, Z_LAYERS.toast, Z_LAYERS.dialog]) {
      expect(Z_LAYERS.peek).toBeLessThan(tier)
    }
  })

  it("is the lowest tier the scale names", () => {
    expect(Math.min(...Object.values(Z_LAYERS))).toBe(Z_LAYERS.peek)
  })
})
