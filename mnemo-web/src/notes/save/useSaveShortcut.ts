/**
 * Ctrl+S (Cmd+S on macOS) in the notes editor: write this note now.
 *
 * ## Why it fires with autosave on as well
 *
 * With autosave off it is the only way to save at all, so it is not optional.
 * With autosave on it is a flush: the note was going to be written a second
 * later anyway, so the keystroke costs one early write and nothing else. People
 * press it reflexively, out of habit from every other editor they have used, and
 * a shortcut that quietly does nothing in half the app is worse than one that
 * always means the same thing.
 *
 * ## Why there is a listener and not only a registration
 *
 * The action is registered under {@link SAVE_ACTION_ID} so that a catalog entry
 * for it dispatches through the shared matcher like any other keybind, which is
 * what makes it rebindable and listable on the keyboard settings page. But the
 * catalog is fetched, and a fetch can fail, arrive late, or simply not carry
 * this action yet; and a global keybind is skipped while a text field has focus
 * unless it is flagged otherwise, which is every single moment someone is typing
 * in a note. Leaving the one shortcut that prevents data loss dependent on all
 * of that is not a trade worth making, so the chord is also matched here
 * directly.
 *
 * The two paths cannot both fire: whichever matches first calls
 * `preventDefault`, and both refuse an event that is already handled.
 *
 * `preventDefault` is not only for that. Unhandled, Ctrl+S is the host's "save
 * page" command, and a file dialog over the editor is the most alarming possible
 * answer to someone trying to save their note.
 */

import { useEffect, useRef } from 'react';

import { matchesEvent, parseChord } from '@/keybinds/chord';
import { registerKeybindAction } from '@/keybinds/registry';

/** The keybind catalog action this hook answers to. */
export const SAVE_ACTION_ID = 'editor.save';

/** The chord matched directly, whatever the catalog says, so a save is always reachable. */
const SAVE_CHORD = parseChord('Primary+S');

/**
 * Binds the save shortcut for as long as the caller is mounted.
 *
 * `save` is read through a ref, so a caller that passes a fresh closure each
 * render does not reinstall the listener.
 */
export function useSaveShortcut(save: () => void): void {
  const latest = useRef(save);
  latest.current = save;

  useEffect(() => {
    const run = () => {
      latest.current();
    };

    const unregister = registerKeybindAction(SAVE_ACTION_ID, run);

    const onKeyDown = (event: KeyboardEvent): void => {
      // Already handled: either the catalog matched this through the shared
      // matcher, or something nearer the keystroke claimed it. Repeats are
      // dropped so holding the keys down does not queue a save per repeat.
      if (event.defaultPrevented || event.repeat) return;
      if (!matchesEvent(SAVE_CHORD, event)) return;
      event.preventDefault();
      run();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      unregister();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
