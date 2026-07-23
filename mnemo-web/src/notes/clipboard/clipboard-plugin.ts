/**
 * The clipboard plugin: copy, cut and paste for the block editor.
 *
 * It sits just after the image-clipboard plugin so an image-file paste is still
 * claimed first. Copy reads `state.doc`, writes the OS clipboard and dispatches
 * no transaction, so it never dirties the note. Cut writes the same payload and
 * then deletes through the selection-aware delete (one undo step) for a block
 * selection, or ProseMirror's own `deleteSelection` for a text range. Paste
 * recovers a slice copied inside the app and drops it at the selection; anything
 * else (an external or plain-text paste) falls through to the editor's default.
 *
 * A composition in flight is left alone: hijacking its clipboard event would cut
 * a half-formed character.
 */

import { Plugin } from 'prosemirror-state';
import { deleteSelection } from 'prosemirror-commands';
import type { EditorView } from 'prosemirror-view';

import type { BlockRegistry } from '../editor/registry/build';
import type { InlineMapper } from '../editor/mapper/inline';
import { createMarkdownSerializer } from '../editor/mapper/serialize-markdown';
import { asOwnUndoStep } from '../editor/history/boundaries';
import { buildDeleteSelected } from '../selection/delete-selected';
import { getBlockSelection } from '../selection/block-selection-plugin';
import { buildCopySlice } from './copy';
import { stashSlice } from './internal-buffer';
import { handleInternalPaste } from './paste';
import { writeSliceToClipboard } from './write-clipboard';

export function clipboardPlugin(registry: BlockRegistry, inline: InlineMapper): Plugin {
  const markdown = createMarkdownSerializer(registry, inline);

  function writeSelection(view: EditorView, data: DataTransfer): boolean {
    if (view.composing) return false;
    const copy = buildCopySlice(view.state, registry);
    if (!copy) return false;

    const nonce = stashSlice(copy.slice, copy.mode);
    const content = copy.slice.content;
    // Block copies render Mnemo markdown per block; a text range is copied as its
    // own plain text so a mid-paragraph selection keeps no block prefix.
    const plainText =
      copy.mode === 'blocks'
        ? markdown.fragment(content)
        : content.textBetween(0, content.size, '\n');
    writeSliceToClipboard(view, data, copy.slice, nonce, plainText, copy.mode);
    return true;
  }

  return new Plugin({
    props: {
      handlePaste(view, event) {
        return handleInternalPaste(view, event.clipboardData, registry);
      },
      handleDOMEvents: {
        copy(view, event) {
          if (!event.clipboardData) return false;
          if (!writeSelection(view, event.clipboardData)) return false;
          event.preventDefault();
          return true;
        },
        cut(view, event) {
          if (!event.clipboardData) return false;
          if (!writeSelection(view, event.clipboardData)) return false;
          event.preventDefault();

          const blockSelection = getBlockSelection(view.state);
          if (blockSelection.selected.size > 0) {
            const tr = buildDeleteSelected(view.state, registry, blockSelection.selected);
            if (tr) {
              view.dispatch(tr);
              view.focus();
            }
            return true;
          }
          // One undo step: this plugin claims the cut, so the history boundary
          // downstream never sees it to fence the delete on its own.
          deleteSelection(view.state, (tr) => view.dispatch(asOwnUndoStep(tr)));
          return true;
        },
      },
    },
  });
}
