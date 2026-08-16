/**
 * The mark command layer: the behaviour the toolbar, keymap and slash surfaces
 * share for inline formatting. The marks themselves live in the schema; this is
 * what toggling one *does*.
 */

export {
  toggleFormat,
  clearStoredMarks,
  isFormatActive,
  activeSwatchToken,
  type ToggleKind,
} from './commands';
