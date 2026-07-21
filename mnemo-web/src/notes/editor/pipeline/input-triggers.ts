/**
 * The input-trigger plugin: one `handleTextInput` that runs the registry's
 * per-block input triggers against what the user is typing.
 *
 * This is the generic engine behind the markdown shortcuts, and behind any later
 * as-you-type rule a module contributes. It knows nothing about markdown: it
 * builds the line text up to and including the character being inserted, and
 * offers it to every trigger registered for the block the caret is in. A trigger
 * whose regex ends in a space only matches when a space is typed — which is how
 * "fire on Space" falls out without being hard-coded here.
 *
 * Two properties keep it cheap and predictable:
 *
 *  - **Per-block.** Only triggers whose owning block type matches the caret's
 *    block are tested, so a note full of block types does not run every module's
 *    regex on every keystroke — the reason the registry keeps each trigger's
 *    owner alongside it.
 *
 *  - **First match wins.** Triggers are tried in registry order and the first one
 *    that both matches and returns a transaction handles the input; the inserted
 *    character is suppressed. A trigger may still decline by returning null (the
 *    line was not actually a whole-line marker, say), and the next one is tried.
 */

import { Plugin } from 'prosemirror-state';
import type { BlockRegistry } from '../registry/build';

export function inputTriggerPlugin(registry: BlockRegistry): Plugin {
  const triggers = registry.inputTriggers;

  return new Plugin({
    props: {
      handleTextInput(view, from, to, text) {
        if (triggers.length === 0) return false;
        // Only a collapsed caret converts. A range being replaced is an edit the
        // user is making to existing content, not a marker being completed.
        if (from !== to) return false;

        const { state } = view;
        const { $from } = state.selection;
        if (!$from.parent.isTextblock || $from.depth < 1) return false;

        const blockName = $from.node($from.depth - 1).type.name;
        // Line text before the caret, plus the character now being typed. Inline
        // atoms contribute nothing here, so a marker regex simply will not match
        // a line that opens with one — which is the correct outcome.
        const matchText = $from.parent.textBetween(0, $from.parentOffset) + text;

        for (const trigger of triggers) {
          if (trigger.nodeName !== blockName) continue;
          const match = trigger.match.exec(matchText);
          if (!match) continue;
          const tr = trigger.handler(state, match, from, to);
          if (tr) {
            view.dispatch(tr.scrollIntoView());
            return true;
          }
        }
        return false;
      },
    },
  });
}
