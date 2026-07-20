/**
 * The central command catalog — the single description of every command the
 * Notes editor offers, and the surfaces derived from it. The keymap lives here;
 * the toolbar and slash menu read the same catalog.
 */

export {
  EDITOR_COMMANDS,
  COMMANDS_BY_ID,
  isCommandEnabled,
  type EditorCommand,
  type DirectCommand,
  type SwatchCommand,
  type CommandGroup,
} from './catalog';
export { editorKeyBindings, editorKeymap, type KeyBindings } from './keymap';
