/**
 * The two-column container's NodeView: the same DOM `toDOM` produces, but with
 * the view owning its outer element.
 *
 * The splitter drag previews by writing `--notes-split` straight onto this
 * element. Rendered through `toDOM` alone, that write is a foreign mutation to
 * ProseMirror's MutationObserver, which responds by redrawing the node, and the
 * redraw destroys the splitter widget mid-drag, killing its `getPos` before the
 * release can commit. `ignoreMutation` is the sanctioned way to say the write
 * was ours.
 *
 * `update` syncs the ratio in place for the same reason at commit time: a
 * `setNodeMarkup` on a `toDOM` node rebuilds the whole subtree, both cells and
 * every NodeView inside them, for a one-attribute change. Returning true here
 * lets ProseMirror keep the children and patch nothing but the style hook.
 *
 * `contentDOM` is the element itself, so the container's line and the two cells
 * render exactly where `toDOM` put them and the CSS keeps matching.
 */

import type { RealizedBlockView, RealizedBlockViewArgs } from '../registry/types';
import type { Node as PMNode } from 'prosemirror-model';
import { displaySplitRatio } from './columns';

export function twoColumnView(
  args: RealizedBlockViewArgs<Record<string, unknown>>,
): RealizedBlockView {
  const dom = document.createElement('div');
  dom.setAttribute('data-two-column', '');

  const sync = (node: PMNode): void => {
    const raw = Number(node.attrs.splitRatio);
    // data-split stays the raw stored value the parser reads back; the CSS
    // variable is the display-normalized share, same split as toDOM.
    dom.setAttribute('data-split', String(node.attrs.splitRatio));
    dom.style.setProperty('--notes-split', String(displaySplitRatio(raw)));
  };
  sync(args.node);

  return {
    dom,
    contentDOM: dom,
    update(node: PMNode): boolean {
      if (node.type !== args.node.type) return false;
      sync(node);
      return true;
    },
    ignoreMutation(mutation) {
      // Only attribute writes on the container itself are ours (the drag
      // preview and `sync`). Anything else, child lists, text, selection,
      // is content and must reach the editor.
      return mutation.type === 'attributes' && mutation.target === dom;
    },
  };
}
