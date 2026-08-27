/**
 * Stacking levels for the shell overlays. These values require compatible ancestor stacking
 * contexts. Paste and drag layers are managed separately; tooltips remain above dialogs.
 */
export const Z_LAYERS = {
  onboarding: 130,
  modal: 140,
  toast: 220,
  dialog: 230,
} as const
