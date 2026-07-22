/**
 * The base nodes every block module builds on.
 *
 * The shape that governs the whole schema: **a block node's first child is
 * always a line, and its block children follow it.** Every block type therefore
 * has the content expression `"line block*"` (or `"codeLine block*"`), with no
 * exceptions, not for dividers, not for atoms, not for containers.
 *
 * That uniformity is what makes the mapper total. Every `Block` on the wire
 * carries `spans`, including the ones the product treats as atomic: a divider
 * has spans, an equation block has spans, an image block stores its caption in
 * `spans[0].text`. If some block nodes held their inline content directly and
 * others held none, the mapper would need a per-type branch for where text
 * lives, and each branch is a place a real note's content can be silently
 * dropped. With a mandatory line there is one answer for every type.
 *
 * The alternative considered and rejected was putting `inline*` directly on
 * each block node. It reads simpler until a container needs both inline content
 * and block children, at which point the content expression has to disambiguate
 * inline from block in the same position, and PM's `fill` behaviour there is
 * subtle enough that two independent mapper prototypes disagreed about it.
 *
 * Restricting the caret is deliberately *not* done here. A divider's line is
 * editable as far as the schema is concerned; keeping content unrestricted is
 * what guarantees a malformed or future note round-trips rather than losing the
 * text nobody expected it to have. Making a divider behave like an atom is a
 * NodeView and command concern, and lives with the code that builds them.
 */

import type { NodeSpec } from 'prosemirror-model';

/**
 * Content is `block+` rather than `block*`: a note is never legitimately empty,
 * and letting PM fill an empty document with one paragraph is cheaper than
 * every consumer handling a doc with no blocks.
 */
export const docSpec: NodeSpec = {
  content: 'block+',
};

/**
 * A block's own inline content.
 *
 * `marks: "_"`, all marks permitted. Restriction, where it exists, belongs to
 * `codeLine`, not to a flag on the containing block.
 */
export const lineSpec: NodeSpec = {
  content: 'inline*',
  marks: '_',
  parseDOM: [{ tag: 'div[data-line]' }],
  toDOM: () => ['div', { 'data-line': '' }, 0],
};

/**
 * The line of a block whose text is source, not prose.
 *
 * `marks: ""` forbids every mark *structurally*, which is what replaces the
 * scattered `if (type != Code)` guards on the C# side. It also fixes a live
 * bug rather than only porting one: autolink today exempts only `Code`, so a
 * URL-shaped token in a sketch DSL gets link-styled. Here neither type can
 * carry a mark at all, so there is no guard left to forget.
 *
 * Real sketch data uses `\r\n` line endings, so this must preserve text
 * verbatim, no newline normalization anywhere on this path.
 */
export const codeLineSpec: NodeSpec = {
  // Atoms are permitted even though nothing creates one inside source. The wire
  // format allows an equation span in a code block, and `WriteSpans` preserves
  // it regardless of block type, so a schema of `text*` would delete content the
  // other side keeps. Marks are the genuine restriction, and they stay banned.
  content: '(text | equationSpan | fractionSpan)*',
  marks: '',
  code: true,
  parseDOM: [{ tag: 'div[data-code-line]', preserveWhitespace: 'full' }],
  toDOM: () => ['div', { 'data-code-line': '' }, 0],
};

export const textSpec: NodeSpec = {
  group: 'inline',
};

/**
 * Declared before every module's node, because ProseMirror resolves a content
 * expression by picking the first matching node type when it has to fill one.
 * `doc` first, then the two line kinds, then `text`.
 */
export const baseNodes: Readonly<Record<string, NodeSpec>> = Object.freeze({
  doc: docSpec,
  line: lineSpec,
  codeLine: codeLineSpec,
  text: textSpec,
});

/** Node names the registry must refuse to let a module redefine. */
export const baseNodeNames: readonly string[] = Object.keys(baseNodes);
