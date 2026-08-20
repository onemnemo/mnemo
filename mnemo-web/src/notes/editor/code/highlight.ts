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
 *
 * ## Range-local rebuilds
 *
 * Caching the tokens is only half of it, and it was the cheap half. In a
 * code-heavy note the tokenizing is a couple of milliseconds and *building the
 * decoration set* out of the results is two orders of magnitude more, because
 * the set is built over the whole document and a document can hold tens of
 * thousands of decorations. Rebuilding all of it on every change made a
 * keystroke cost the size of the note, and made each background chunk of a
 * large note's load pay for every block already mounted.
 *
 * So an edit maps the existing set through the transaction and rebuilds only the
 * top-level blocks the change touched, exactly as the intrinsic-size plugin
 * next door does with its reserved heights. That is sound here because a code
 * block's colours are a function of that block alone: the tokenizer runs per
 * code line and never looks outside it, so a block no change reached cannot have
 * different colours than it had a moment ago. The initial build is still whole,
 * because there is nothing yet to map.
 */

import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { changedRanges, type DocRange } from '../pipeline/invariants';
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

/** The inline decorations colouring every code block inside `range`. */
function decorationsIn(doc: PMNode, range: DocRange): Decoration[] {
  const decos: Decoration[] = [];

  doc.nodesBetween(range.from, range.to, (node, pos) => {
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
 * The inline decorations colouring every code block in `doc`.
 *
 * Exported so the tokenizer's output can be asserted against a real document
 * without mounting a view, and so a test can hold the incremental set against
 * the whole-document one it has to keep agreeing with.
 */
export function codeHighlightDecorations(doc: PMNode): Decoration[] {
  return decorationsIn(doc, { from: 0, to: doc.content.size });
}

/**
 * The top-level blocks a transaction touched, as absolute spans of the new
 * document, with neighbours joined.
 *
 * Widened to whole top-level blocks rather than used as reported, because the
 * reported range says where the document differs, not which text has to be read
 * again. Joining two code blocks deletes the boundary between them and reports
 * an empty range where it used to be; the block that survives holds text that
 * was never tokenized together before. Counting a range as touching a block it
 * merely abuts is what covers that, and it costs at worst one extra block's
 * worth of work on an ordinary keystroke.
 */
function spansToRebuild(doc: PMNode, tr: Transaction): DocRange[] {
  const ranges = changedRanges([tr]);
  const furthest = ranges[ranges.length - 1];
  if (!furthest) return [];

  const spans: { from: number; to: number }[] = [];
  let offset = 0;
  for (let i = 0; i < doc.childCount && offset <= furthest.to; i++) {
    const end = offset + doc.child(i).nodeSize;
    if (ranges.some((range) => end >= range.from && offset <= range.to)) {
      const previous = spans[spans.length - 1];
      if (previous && previous.to === offset) previous.to = end;
      else spans.push({ from: offset, to: end });
    }
    offset = end;
  }
  return spans;
}

/**
 * The decorations a span replaces.
 *
 * `find` reports anything that so much as touches the span's edge, and a
 * decoration sitting exactly on the boundary belongs to the neighbouring block,
 * which is not being rebuilt. Dropping it there would leave that block's last
 * token uncoloured until something else happened to it.
 */
function staleIn(set: DecorationSet, span: DocRange): Decoration[] {
  return set.find(span.from, span.to).filter((deco) => deco.to > span.from && deco.from < span.to);
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
        let next = old.map(tr.mapping, newState.doc);
        for (const span of spansToRebuild(newState.doc, tr)) {
          next = next.remove(staleIn(next, span));
          next = next.add(newState.doc, decorationsIn(newState.doc, span));
        }
        return next;
      },
    },
    props: {
      decorations(this: Plugin<DecorationSet>, state: EditorState) {
        return this.getState(state);
      },
    },
  });
}
