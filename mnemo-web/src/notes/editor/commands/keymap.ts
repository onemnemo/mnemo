/**
 * The editor keymap, derived from the command catalog.
 *
 * Shortcuts are not a second list, they are the `shortcut` field of the same
 * catalog the toolbar and slash menu read, projected into the binding map
 * ProseMirror's keymap plugin wants. A command's chord lives with the command,
 * so there is one place to change it and no way for the keymap to bind a chord to
 * a behaviour the toolbar labels differently.
 *
 * Only direct commands with a shortcut bind. Swatches take a token chosen at
 * click time and have no fixed chord; the equation and inline code carry none on
 * the desktop and carry none here.
 *
 * The keymap is editor-scoped: mounted as a plugin on the note's `EditorState`,
 * it matches only while the view holds selection, which is exactly the scope
 * inline formatting should have. When a global keybind layer later seeds these
 * same ids it must stay out of text capture so a focused editor's own keymap
 * owns the chord rather than both firing.
 */

import { keymap } from 'prosemirror-keymap';
import type { Command, Plugin } from 'prosemirror-state';
import { EDITOR_COMMANDS, type EditorCommand } from './catalog';

export type KeyBindings = Record<string, Command>;

/** The catalog's shortcuts as a ProseMirror binding map. */
export function editorKeyBindings(
  commands: readonly EditorCommand[] = EDITOR_COMMANDS,
): KeyBindings {
  const bindings: KeyBindings = {};
  for (const command of commands) {
    if (command.kind !== 'direct' || !command.shortcut) continue;
    // Aliases bind exactly as the primary chord does, and collide exactly as
    // loudly, an alias quietly shadowing another command's shortcut would be
    // the worse bug, because nothing in the UI names it.
    for (const chord of [command.shortcut, ...(command.aliases ?? [])]) {
      // Two commands on one chord is a catalog bug, not something to merge: the
      // later binding would silently shadow the earlier. Refuse it at build time.
      if (Object.prototype.hasOwnProperty.call(bindings, chord)) {
        throw new Error(`Duplicate editor shortcut "${chord}" (${command.id}).`);
      }
      bindings[chord] = command.run;
    }
  }
  return bindings;
}

/** The keymap plugin to include in a note's `EditorState` plugins. */
export function editorKeymap(commands?: readonly EditorCommand[]): Plugin {
  return keymap(editorKeyBindings(commands));
}
