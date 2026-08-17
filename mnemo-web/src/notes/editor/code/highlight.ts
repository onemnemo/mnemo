/**
 * Syntax colour, as decorations over the block's own text.
 *
 * The prototype painted a `<pre>` underneath a transparent `<textarea>` because
 * a standalone React component has no other way to be both coloured and typable.
 * Here the caret is ProseMirror's already, so the colour is the only thing left
 * to add and it goes on as inline decorations. Nothing about the document
 * changes, which is the point: highlighting is a view concern, and a note whose
 * stored bytes differed by language would be a note the highlighter could
 * corrupt.
 *
 * Per-node caching, not per-document. PM nodes are immutable and shared across
 * transactions, so a `WeakMap` keyed on the line node makes a keystroke in one
 * code block cost one tokenize rather than one per code block in the note.
 */

import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { isPlainLanguage, tokenize, type TokenKind } from './syntax';

const highlightKey = new PluginKey<DecorationSet>('notes-code-highlight');

/** Ranges relative to the start of the line's content, so the cache survives a move. */
interface Span {
  readonly from: number;
  readonly to: number;
  readonly kind: TokenKind;
}

/**
 * Keyed by line *and* language: switching the picker leaves the line node
 * untouched, so a cache keyed on the node alone would keep painting the old
 * grammar's colours over the new one's.
 */
const cache = new WeakMap<PMNode, Map<string, readonly Span[]>>();

/**
 * The line's text, or null when it holds anything that is not text.
 *
 * The wire format permits an inline atom inside source and the mapper preserves
 * one, so such a line exists even though nothing in the product creates it. An
 * atom projects many characters of LaTeX while occupying one position, so token
 * offsets and PM positions stop being related by addition, and a decoration
 * computed as though they were would paint colour across the wrong characters.
 * Leaving the block uncoloured is the honest answer.
 */
function plainTextOf(line: PMNode): string | null {
  let text = '';
  let ok = true;
  line.content.forEach((child) => {
    if (!child.isText) {
      ok = false;
      return;
    }
    text += child.text ?? '';
  });
  return ok ? text : null;
}

function spansFor(line: PMNode, language: string): readonly Span[] {
  let byLanguage = cache.get(line);
  if (!byLanguage) {
    byLanguage = new Map();
    cache.set(line, byLanguage);
  }
  const cached = byLanguage.get(language);
  if (cached) return cached;

  const text = plainTextOf(line);
  const spans: Span[] = [];
  if (text !== null) {
    let at = 0;
    for (const token of tokenize(text, language)) {
      const to = at + token.text.length;
      // Plain runs get no decoration at all: the block's own colour already is
      // the plain one, and an empty span per identifier doubles the set for
      // nothing.
      if (token.kind !== 'plain') spans.push({ from: at, to, kind: token.kind });
      at = to;
    }
  }
  byLanguage.set(language, spans);
  return spans;
}

/**
 * The inline decorations colouring every code block in `doc`.
 *
 * Exported so the tokenizer's output can be asserted against a real document
 * without mounting a view.
 */
export function codeHighlightDecorations(doc: PMNode): Decoration[] {
  const decos: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return true;
    const language = String(node.attrs.language ?? '');
    if (isPlainLanguage(language)) return false;

    const line = node.firstChild;
    if (!line || line.type.name !== 'codeLine') return false;

    // The block opens at `pos`, its line at `pos + 1`, and the line's content at
    // `pos + 2`.
    const base = pos + 2;
    for (const span of spansFor(line, language)) {
      decos.push(
        Decoration.inline(base + span.from, base + span.to, { class: `notes-tok-${span.kind}` }),
      );
    }
    // Source has no block children worth descending into, and a nested code
    // block is not a shape the schema can produce.
    return false;
  });

  return decos;
}

/**
 * Colours source in both the editable and the read-only view. Decoration only,
 * so it appends no step and never dirties the note.
 */
export function codeHighlightPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: highlightKey,
    state: {
      init: (_config, state) => DecorationSet.create(state.doc, codeHighlightDecorations(state.doc)),
      apply(tr, old, _oldState, newState) {
        if (!tr.docChanged) return old;
        return DecorationSet.create(newState.doc, codeHighlightDecorations(newState.doc));
      },
    },
    props: {
      decorations(this: Plugin<DecorationSet>, state: EditorState) {
        return this.getState(state);
      },
    },
  });
}
