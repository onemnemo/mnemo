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
  /**
   * A menu opened from inside a modal. Menus portal to the body and compare against the
   * whole app, so at their own tier one opened inside a dialog paints behind it and reads
   * as a control that does nothing. Only those opt up: leaving every menu here would put
   * them over the window resize edges, which is not where they have ever been. Spelled as
   * a utility class in components/ui/modal-menu.ts, which is pinned to this number.
   */
  modalMenu: 150,
  toast: 220,
  dialog: 230,
} as const
