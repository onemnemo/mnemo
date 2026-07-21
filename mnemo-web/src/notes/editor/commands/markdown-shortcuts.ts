/**
 * The block-level markdown shortcuts: type `# `, `- `, `> `, ``` ``` ` `, `[] `,
 * `--- ` at the start of a paragraph and the block converts.
 *
 * This ports `MarkdownShortcutDetector`, which fired on Space and split into two
 * families:
 *
 *  - **Leading list markers** (`- `, `* `, `+ `, `<digits>. `) — the marker is
 *    stripped and whatever follows the caret stays as the list item's body. So
 *    typing `- ` in front of existing text turns the line into a bullet without
 *    losing the text.
 *
 *  - **Whole-line shortcuts** (`# `..`#### `, `> `, `[] `/`[ ] `, ``` ``` ` `,
 *    `--- `) — the whole line is the marker, so there is nothing to keep; the
 *    block is converted with its content cleared.
 *
 * All of them fire from a paragraph via the `paragraph` module's triggers, which
 * is what the input-trigger plugin's per-block filter keys on. The desktop let
 * the whole-line family fire from any non-image block; scoping them to paragraph
 * is a deliberate divergence — it is the block every markdown shortcut is
 * launched from in practice, and it keeps `# ` inside a quote as the literal text
 * the user typed rather than silently destroying the quote. See the migration
 * notes for the parity call.
 *
 * The displayed number of a `<digits>. ` shortcut is not honoured: the port does
 * not store a list number (a decoration recomputes it from document order), so a
 * `5. ` starts wherever its position dictates, not at five. That is the same
 * "number-not-stored" divergence the numbered-list module documents.
 */

import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import type { InputTriggerContribution } from '../registry/types';
import { blockContext, convertBlockType, isContentVisuallyEmpty } from './structure';

/**
 * Converts the caret's paragraph to a list item, dropping the leading marker and
 * keeping everything after the caret as the item body.
 */
function convertLeadingMarker(state: EditorState, targetNodeName: string): Transaction | null {
  const ctx = blockContext(state);
  if (!ctx) return null;
  const { block, blockPos, offset } = ctx;
  const target = state.schema.nodes[targetNodeName];
  if (!target) return null;

  const tr = state.tr;
  // Same line kind (paragraph -> list item), so this is a `setNodeMarkup` that
  // leaves the body content and its marks in place; identity carries across.
  convertBlockType(tr, blockPos, block, target, { content: 'preserve' });
  // Strip the marker — the `offset` characters that sat before the caret. The
  // space that triggered us was never inserted, so nothing else needs removing.
  if (offset > 0) tr.delete(blockPos + 2, blockPos + 2 + offset);
  tr.setSelection(TextSelection.create(tr.doc, blockPos + 2));
  return tr;
}

/**
 * Converts the caret's paragraph to `targetNodeName`, clearing its content —
 * only when nothing follows the caret, so a whole-line marker like `# ` converts
 * but `#foo` (caret after the `#`) is left alone to become literal text.
 */
function convertWholeLine(
  state: EditorState,
  targetNodeName: string,
  attrs?: Record<string, unknown>,
): Transaction | null {
  const ctx = blockContext(state);
  if (!ctx) return null;
  const { block, blockPos, line, offset } = ctx;
  // Anything after the caret means the line is not just the marker. "Anything"
  // has to include an inline atom: an equation carries no text, so a text-only
  // check would read `#<equation>` as a bare marker and clear the line over it.
  const after = line.content.cut(offset);
  if (!isContentVisuallyEmpty(after)) return null;

  const target = state.schema.nodes[targetNodeName];
  if (!target) return null;

  const tr = state.tr;
  convertBlockType(tr, blockPos, block, target, { attrs, content: 'clear' });
  tr.setSelection(TextSelection.create(tr.doc, blockPos + 2));
  return tr;
}

/**
 * The paragraph module's markdown-shortcut triggers.
 *
 * Each regex is matched against the line text up to and including the just-typed
 * character, so they end in a literal space — which is what makes the whole set
 * "fire on Space" without the plugin knowing that rule. The anchors guarantee the
 * marker is the entire prefix, so the handlers can trust `offset` as the marker
 * length.
 */
export function markdownShortcutTriggers(): readonly InputTriggerContribution[] {
  const heading = (level: number): InputTriggerContribution => ({
    id: `markdown.heading${String(level)}`,
    match: new RegExp(`^#{${String(level)}} $`),
    handler: (state) => convertWholeLine(state, 'heading', { level }),
  });

  return [
    // Leading list markers keep the remainder as the item body.
    {
      id: 'markdown.bullet',
      match: /^[-*+] $/,
      handler: (state) => convertLeadingMarker(state, 'bulletItem'),
    },
    {
      id: 'markdown.numbered',
      match: /^\d+\. $/,
      handler: (state) => convertLeadingMarker(state, 'numberedItem'),
    },
    // Whole-line shortcuts clear the line.
    heading(1),
    heading(2),
    heading(3),
    heading(4),
    {
      id: 'markdown.checklist',
      match: /^\[ ?\] $/,
      handler: (state) => convertWholeLine(state, 'checklistItem'),
    },
    {
      id: 'markdown.quote',
      match: /^> $/,
      handler: (state) => convertWholeLine(state, 'quote'),
    },
    {
      id: 'markdown.code',
      match: /^``` $/,
      handler: (state) => convertWholeLine(state, 'codeBlock', { language: 'csharp' }),
    },
    {
      id: 'markdown.divider',
      match: /^--- $/,
      // Caret stays in the divider's now-empty line; the divider NodeView
      // is responsible for making it atomic and escaping the caret to a block below.
      handler: (state) => convertWholeLine(state, 'divider'),
    },
  ];
}
