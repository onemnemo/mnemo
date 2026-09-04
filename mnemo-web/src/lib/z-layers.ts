/**
 * Stacking levels for the shell overlays. These values require compatible ancestor stacking
 * contexts. Paste and drag layers are managed separately; tooltips remain above dialogs.
 */
export const Z_LAYERS = {
  /**
   * The side peek when it overlays the canvas instead of taking a column. It is a
   * reading surface over a module rather than chrome over the app, so it sits below
   * every layer here and below the window resize edges too.
   */
  peek: 90,
  /**
   * Menus, context menus and popovers. They portal to the body, so without a tier of
   * their own they compare against the whole app from the root stacking context, and a
   * surface as low as an overlaying side peek painted over them, its own options menu
   * included. Deliberately still under the window resize edges, which is where they
   * have always been. Spelled as a utility class in components/ui/menu-styles.ts and
   * components/ui/popover.tsx; the peek z test pins those two to this number.
   */
  menu: 95,
  onboarding: 130,
  modal: 140,
  toast: 220,
  dialog: 230,
} as const
