/**
 * The input-trigger plugin: one `handleTextInput` that runs the registry's
 * per-block input triggers against what the user is typing.
 *
 * This is the generic engine behind the markdown shortcuts, and behind any later
 * as-you-type rule a module contributes. It knows nothing about markdown: it
 * builds the line text up to and including the character being inserted, and
 * offers it to every trigger registered for the block the caret is in. A trigger
 * whose regex ends in a space only matches when a space is typed, which is how
 * "fire on Space" falls out without being hard-coded here.
 *
 * Two properties keep it cheap and predictable:
 *
 *  - **Per-block.** Only triggers whose owning block type matches the caret's
 *    block are tested, so a note full of block types does not run every module's
 *    regex on every keystroke, the reason the registry keeps each trigger's
 *    owner alongside it.
 *
 *  - **First match wins.** Triggers are tried in registry order and the first one
 *    that both matches and returns a transaction handles the input; the inserted
 *    character is suppressed. A trigger may still decline by returning null (the
 *    line was not actually a whole-line marker, say), and the next one is tried.
 */

import { Plugin } from 'prosemirror-state';
import type { BlockRegistry } from '../registry/build';
import { asOwnUndoStep } from '../history';

export function inputTriggerPlugin(registry: BlockRegistry): Plugin {
  const triggers = registry.inputTriggers;

  return new Plugin({
    props: {
      handleTextInput(view, from, to, text) {
        if (triggers.length === 0) return false;
        // Nothing fires mid-composition. ProseMirror reaches this hook from its
        // DOM-change reader as well as from keypress, and only the keypress path
        // screens for composition, so an IME candidate, a dead-key sequence or
        // a stacking script can arrive here carrying intermediate text over a
        // range the input method still owns. Converting the block underneath it
        // rewrites positions the IME is about to write to.
        if (view.composing) return false;
        // Only a collapsed caret converts. A range being replaced is an edit the
        // user is making to existing content, not a marker being completed.
        if (from !== to) return false;

        const { state } = view;
        const { $from } = state.selection;
        if (!$from.parent.isTextblock || $from.depth < 1) return false;

        const blockName = $from.node($from.depth - 1).type.name;
        // Line text before the caret, plus the character now being typed.
        const textBefore = $from.parent.textBetween(0, $from.parentOffset);
        // An inline atom holds a position but contributes no text, so the two
        // disagree exactly when one is in the prefix. A handler that trusted the
        // caret offset as a marker length would then delete the atom along with
        // the marker, so no trigger is offered a prefix it cannot measure.
        if (textBefore.length !== $from.parentOffset) return false;
        const matchText = textBefore + text;

        for (const trigger of triggers) {
          if (trigger.nodeName !== blockName) continue;
          const match = trigger.match.exec(matchText);
          if (!match) continue;
          const tr = trigger.handler(state, match, from, to);
          if (tr) {
            // The conversion is its own undo step, so a first press takes back
            // the block type and gives the marker text back to be edited, the
            // repair path when a shortcut fires and was not wanted.
            view.dispatch(asOwnUndoStep(tr.scrollIntoView()));
            return true;
          }
        }
        return false;
      },
    },
  });
}
