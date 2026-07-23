/**
 * The draggable divider that resizes a two-column split.
 *
 * A widget decoration between the two column DOM elements, not a realized
 * NodeView: a NodeView has a single contentDOM and both cells render into it in
 * order, so a splitter could not be injected between them there either. Only the
 * editable view mounts this (a reader has nothing to drag), which is why it lives
 * in `editorPlugins` and not on the read path.
 *
 * Dragging previews purely in the DOM, by writing the container's `--notes-split`
 * variable, and commits a single transaction on release. This ports the desktop's
 * live grid resize plus its Begin/Commit undo bracket: no per-move transaction
 * means the two-column is not re-rendered on every pixel, and one committed
 * `setNodeMarkup` is one undo step and one autosave, no matter how far the drag
 * travelled.
 */

import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { displaySplitRatio } from '../blocks/columns';
import { asOwnUndoStep } from '../history';

const splitterKey = new PluginKey<DecorationSet>('notes-column-splitter');

const MIN_RATIO = 0.1;
const MAX_RATIO = 0.9;

/** The stored ratio is the left lane's share; a splitter is held to a visible minimum on each side. */
export function clampRatio(ratio: number): number {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}

/** The two-column that owns a widget sitting at `pos`, with its own position. */
function twoColumnAt(state: EditorState, pos: number): { pos: number; node: PMNode } | null {
  const $pos = state.doc.resolve(pos);
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === 'twoColumn') return { pos: $pos.before(depth), node };
  }
  return null;
}

function buildSplitter(view: EditorView, getPos: () => number | undefined): HTMLElement {
  const el = document.createElement('div');
  el.className = 'notes-column-splitter';
  el.setAttribute('contenteditable', 'false');
  el.setAttribute('aria-hidden', 'true');
  const grip = document.createElement('div');
  grip.className = 'notes-column-splitter-grip';
  el.appendChild(grip);

  let container: HTMLElement | null = null;
  let originalRatio = 0.5;

  const ratioAt = (clientX: number): number | null => {
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    if (rect.width <= 1) return null;
    return clampRatio((clientX - rect.left) / rect.width);
  };

  const onMove = (event: PointerEvent) => {
    const ratio = ratioAt(event.clientX);
    // Preview only: the model is left alone until the drag commits, so nothing
    // re-renders and the drag stays smooth.
    if (ratio != null && container) container.style.setProperty('--notes-split', String(ratio));
  };

  const onUp = (event: PointerEvent) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    el.classList.remove('is-dragging');

    const pos = getPos();
    if (pos == null) return;
    const tc = twoColumnAt(view.state, pos);
    if (!tc) return;
    const finalRatio = ratioAt(event.clientX) ?? originalRatio;
    if (finalRatio === originalRatio) return; // a click that never moved changes nothing
    // One committed step from the pre-drag ratio to the released one, so a single
    // undo restores where the split started.
    const tr = view.state.tr.setNodeMarkup(tc.pos, undefined, {
      ...tc.node.attrs,
      splitRatio: finalRatio,
    });
    view.dispatch(asOwnUndoStep(tr));
  };

  el.addEventListener('pointerdown', (event) => {
    const pos = getPos();
    if (pos == null) return;
    const tc = twoColumnAt(view.state, pos);
    if (!tc) return;
    event.preventDefault();
    container = el.closest('[data-two-column]');
    originalRatio = displaySplitRatio(Number(tc.node.attrs.splitRatio));
    el.classList.add('is-dragging');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  return el;
}

/**
 * A splitter widget between the columns of every two-column in the document. The
 * position math is the whole point of the pure function: after the container's
 * own line and the entire left cell, which is exactly the seam between the two
 * rendered `[data-column]` elements.
 */
export function columnSplitterDecorations(doc: PMNode): Decoration[] {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'twoColumn') return true;
    const widgetPos = pos + 1 + node.child(0).nodeSize + node.child(1).nodeSize;
    decos.push(
      Decoration.widget(widgetPos, (view, getPos) => buildSplitter(view, getPos), {
        key: `notes-column-splitter@${pos}`,
        side: 0,
        ignoreSelection: true,
        // The widget owns its pointer events; the editor must not read them as input.
        stopEvent: () => true,
      }),
    );
    // Descend: a nested two-column gets its own splitter.
    return true;
  });
  return decos;
}

/** Rebuilds the splitter set on any document change, like the other decoration plugins. */
export function columnSplitterPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: splitterKey,
    state: {
      init: (_config, state) =>
        DecorationSet.create(state.doc, columnSplitterDecorations(state.doc)),
      apply(tr, old, _oldState, newState) {
        if (!tr.docChanged) return old;
        return DecorationSet.create(newState.doc, columnSplitterDecorations(newState.doc));
      },
    },
    props: {
      decorations(this: Plugin<DecorationSet>, state: EditorState) {
        return this.getState(state);
      },
    },
  });
}
