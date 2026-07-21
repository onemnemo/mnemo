/**
 * The structural editing commands: Enter (split), Backspace (merge / de-format),
 * and the in-place block type conversion both of them lean on.
 *
 * These port the Avalonia `KeyboardHandler` + `HandleEnterPressed` +
 * `QuoteEnterBehavior` decision tree, which is where the editor's whole feel
 * lives. Two properties of that port are load-bearing:
 *
 *  - **Type conversion never re-mints identity.** Changing a block's type is a
 *    `setNodeMarkup` (or a line-kind-preserving rebuild) that carries `id`, `sid`,
 *    `order` and `meta` across unchanged. A delete-and-reinsert would hand the
 *    block a fresh `sid`, and a re-minted sid is one the AI has already named in
 *    chat history — the exact loss the sid contract exists to prevent.
 *
 *  - **New blocks carry no identity.** A split or an insert-above builds a block
 *    with an empty `sid`; the document authority mints one on commit, and only it
 *    may, because minting is check-and-retry against the ids already in the note.
 *    So nothing here calls into the id layer.
 *
 * The invariant pipeline runs after every one of these, so a split that lands
 * text in a heading, or a merge that appends into one, gets its bold reapplied
 * without this file knowing the rule exists.
 */

import { Fragment, Mark, type Node as PMNode, type NodeType } from 'prosemirror-model';
import { TextSelection, type Command, type Transaction } from 'prosemirror-state';
import { keymap } from 'prosemirror-keymap';
import type { Plugin } from 'prosemirror-state';
import { blockChildrenOf, lineOf } from '../blocks/shared';
import { asOwnUndoStep } from '../history';

/** Earlier builds stored a U+200B in empty paragraphs; it is never visible text. */
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

/** The list item node types — the ones a split keeps as a same-type sibling. */
const LIST_NODE_NAMES: ReadonlySet<string> = new Set([
  'bulletItem',
  'numberedItem',
  'checklistItem',
]);

/**
 * "Visually empty" the way the desktop's `BlockEditorContentPolicy` meant it:
 * whitespace-only after the legacy sentinel is stripped. An empty line, a line of
 * spaces, and a lone sentinel all read as empty, because to the user they are.
 */
export function isVisuallyEmpty(text: string): boolean {
  return text.split(ZERO_WIDTH_SPACE).join('').trim() === '';
}

/**
 * The same question asked of a line's content rather than of its text: empty of
 * visible text *and* free of inline atoms.
 *
 * An equation contributes no text — it holds a position and renders from its
 * attrs — so a line containing nothing but one reads as blank to
 * {@link isVisuallyEmpty}. Every rule that treats "empty" as licence to clear or
 * delete has to ask this instead, or typing Enter on a bullet holding a formula
 * silently destroys it.
 */
export function isContentVisuallyEmpty(content: Fragment): boolean {
  if (hasInlineAtom(content)) return false;
  return isVisuallyEmpty(content.textBetween(0, content.size));
}

/**
 * Whether any non-text node sits in this inline content. Two consequences follow
 * from one: such a node is visible without being text, and it makes a text offset
 * and a content position disagree — so anything cutting content at an offset
 * derived from text has to check this first.
 */
export function hasInlineAtom(content: Fragment): boolean {
  let found = false;
  content.forEach((child) => {
    if (!child.isText) found = true;
  });
  return found;
}

export interface BlockContext {
  /** The block whose line holds the caret — the innermost one, so a nested cell works. */
  readonly block: PMNode;
  /** Position immediately before `block`. */
  readonly blockPos: number;
  /** The block's line (or codeLine) node. */
  readonly line: PMNode;
  /** Caret offset within the line's content. */
  readonly offset: number;
}

/**
 * The block the caret sits in, or null when the selection is not inside an
 * editable line (a node selection on an atom, say). Every structural command
 * needs the same three coordinates, computed once here.
 */
export function blockContext(state: Parameters<Command>[0]): BlockContext | null {
  const { $from } = state.selection;
  const line = $from.parent;
  // The caret must be in inline content; doc > block > line means the line's
  // parent is always the block, one level up.
  if (!line.isTextblock || $from.depth < 1) return null;
  const blockDepth = $from.depth - 1;
  return {
    block: $from.node(blockDepth),
    blockPos: $from.before(blockDepth),
    line,
    offset: $from.parentOffset,
  };
}

/**
 * Dispatch a structural edit: one press, one undo step.
 *
 * Every command here except {@link insertSoftBreak} goes through this. A split, a
 * merge, a delete, a de-format — the desktop pushed each as its own
 * `DocumentOperation` and flushed the open typing batch on the way in, so none of
 * them ever shared an undo entry with the typing around it. A soft break is the
 * exception on both sides: it inserts a character into one block, and the desktop
 * recorded it as typing too.
 */
function dispatchStructural(
  tr: Transaction,
  dispatch?: (tr: Transaction) => void,
): true {
  if (dispatch) dispatch(asOwnUndoStep(tr));
  return true;
}

/** The four attrs that must survive a type change untouched. */
function commonAttrs(node: PMNode): Record<string, unknown> {
  return {
    id: node.attrs.id,
    sid: node.attrs.sid,
    order: node.attrs.order,
    meta: node.attrs.meta,
  };
}

/**
 * The line node a block type wants for its inline content — `codeLine` for the
 * source blocks, `line` for everyone else. Read off the type's own content
 * expression rather than a hardcoded name list, so a new source block type is
 * handled the day it is added.
 */
function lineTypeFor(type: NodeType): NodeType {
  const { codeLine, line } = type.schema.nodes;
  return type.contentMatch.matchType(codeLine) ? codeLine : line;
}

/** A fresh, identity-less empty Text block — what an insert-above drops in. */
function emptyTextBlock(schema: NodeType['schema']): PMNode {
  return schema.nodes.paragraph.create(null, schema.nodes.line.create());
}

/** Re-wraps inline content with no marks, for insertion into a mark-forbidding codeLine. */
function stripMarks(content: Fragment): Fragment {
  const out: PMNode[] = [];
  content.forEach((child) => out.push(child.mark(Mark.none)));
  return Fragment.fromArray(out);
}

/**
 * Convert the block at `pos` to `targetType` in place, preserving identity.
 *
 * When the line kind does not change (the common case — every prose type shares
 * `line`), this is a `setNodeMarkup`, so content and its marks stay put. Only a
 * cross-kind change (to or from a code block) rebuilds the node, because a
 * `codeLine` cannot hold what a `line` held and vice versa.
 *
 * Leaving a heading strips the forced bold here, not in the invariant pipeline:
 * a rule reacting to the resulting paragraph cannot tell that its bold used to be
 * a heading's rather than the user's, so the command that knew the block was a
 * heading is the only place that can.
 */
export function convertBlockType(
  tr: Transaction,
  pos: number,
  node: PMNode,
  targetType: NodeType,
  opts: { attrs?: Record<string, unknown>; content?: 'preserve' | 'clear' } = {},
): Transaction {
  const schema = targetType.schema;
  const attrs = { ...commonAttrs(node), ...(opts.attrs ?? {}) };
  const targetLine = lineTypeFor(targetType);
  const oldLine = lineOf(node);
  const preserve = (opts.content ?? 'preserve') === 'preserve';
  const leavingHeading = node.type.name === 'heading' && targetType.name !== 'heading';
  const sameLineKind = oldLine != null && oldLine.type === targetLine;

  if (sameLineKind && preserve) {
    tr.setNodeMarkup(pos, targetType, attrs);
    if (leavingHeading) {
      const strong = schema.marks.strong;
      const size = oldLine!.content.size;
      if (strong && size > 0) tr.removeMark(pos + 2, pos + 2 + size, strong);
    }
    return tr;
  }

  // Line kind changes, or the caller wants the content reset: rebuild the node.
  let lineContent: Fragment | null = null;
  if (preserve && oldLine) {
    lineContent =
      targetLine === schema.nodes.codeLine ? stripMarks(oldLine.content) : oldLine.content;
  }
  const newLine = targetLine.create(null, lineContent);
  const rebuilt = targetType.create(attrs, [newLine, ...blockChildrenOf(node)]);
  tr.replaceWith(pos, pos + node.nodeSize, rebuilt);
  return tr;
}

/**
 * Insert a literal newline at the caret. This is the Ctrl/Cmd+Enter behaviour
 * everywhere, and the plain-Enter behaviour inside code (multi-line source) and
 * inside a quote whose current line still has text (a soft wrap, not an exit).
 */
export const insertSoftBreak: Command = (state, dispatch) => {
  const { from, to } = state.selection;
  if (dispatch) dispatch(state.tr.insertText('\n', from, to).scrollIntoView());
  return true;
};

/** `text.LastIndexOf('\n', caret-1)+1` .. next `\n` — the visual line the caret is on. */
function visualLineBounds(text: string, caret: number): { start: number; endExcl: number } {
  const start = caret === 0 ? 0 : text.lastIndexOf('\n', caret - 1) + 1;
  const nl = text.indexOf('\n', start);
  return { start, endExcl: nl < 0 ? text.length : nl };
}

/** Whether the caret sits on a whitespace-only visual line — the quote exit trigger. */
function caretOnBlankVisualLine(text: string, caret: number): boolean {
  const { start, endExcl } = visualLineBounds(text, caret);
  return isVisuallyEmpty(text.slice(start, endExcl));
}

/** Splits a quote at a blank line: body stays a quote, the tail becomes a Text block. */
function splitQuoteOnBlankLine(
  state: Parameters<Command>[0],
  ctx: BlockContext,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const { block, blockPos, line, offset } = ctx;
  const text = line.textContent;
  const { start, endExcl } = visualLineBounds(text, offset);

  // Trailing \r\n before the blank line belongs to neither side — trim it off the body.
  let bodyEnd = start;
  while (bodyEnd > 0 && (text[bodyEnd - 1] === '\n' || text[bodyEnd - 1] === '\r')) bodyEnd--;

  // Skip the line separator after the blank line, then any further leading breaks.
  let tailStart = endExcl;
  if (text[tailStart] === '\r' && text[tailStart + 1] === '\n') tailStart += 2;
  else if (text[tailStart] === '\n' || text[tailStart] === '\r') tailStart += 1;
  while (text[tailStart] === '\r' || text[tailStart] === '\n') tailStart++;

  // Quotes are prose, so text offsets and content positions coincide (no atoms
  // sit at a blank-line boundary in practice); cut the fragment at those offsets.
  const bodyContent = line.content.cut(0, Math.min(bodyEnd, line.content.size));
  const tailContent = line.content.cut(Math.min(tailStart, line.content.size));

  const schema = state.schema;
  const lineContentStart = blockPos + 2;
  const lineContentEnd = lineContentStart + line.content.size;
  const blockEnd = blockPos + block.nodeSize;

  const tr = state.tr;
  tr.replaceWith(lineContentStart, lineContentEnd, bodyContent);
  const insertAt = blockEnd - (line.content.size - bodyContent.size);
  const below = schema.nodes.paragraph.create(null, schema.nodes.line.create(null, tailContent));
  tr.insert(insertAt, below);
  tr.setSelection(TextSelection.create(tr.doc, insertAt + 2));
  return dispatchStructural(tr.scrollIntoView(), dispatch);
}

/**
 * Enter. The dispatch mirrors the desktop exactly: code and soft-wrapped quotes
 * insert a newline, an empty list item leaves the list, an empty-line quote exits
 * to a Text block, a caret at the very start pushes an empty block above, and
 * everything else splits — lists into a same-type sibling, all else into Text.
 */
export const splitBlock: Command = (state, dispatch) => {
  const sel = state.selection;
  if (!(sel instanceof TextSelection)) return false;
  const ctx = blockContext(state);
  if (!ctx) return false;
  // A selection spanning blocks is out of scope here; let it fall through rather
  // than guess how to split across a boundary.
  if (!sel.empty && !sel.$from.sameParent(sel.$to)) return false;

  const { block, blockPos, line, offset } = ctx;
  const schema = state.schema;

  // Source blocks: plain Enter is a newline in the source, never a split.
  if (line.type.name === 'codeLine') return insertSoftBreak(state, dispatch);

  const fromOff = sel.$from.parentOffset;
  const toOff = sel.empty ? fromOff : sel.$to.parentOffset;
  const before = line.content.cut(0, fromOff);
  const after = line.content.cut(toOff);
  const blank = isContentVisuallyEmpty(before) && isContentVisuallyEmpty(after);

  // Quote: an empty current line exits to a new Text block; otherwise soft-wrap.
  if (block.type.name === 'quote') {
    // The blank-line split cuts the line at offsets measured in text, which only
    // line up with content positions while the line is all text. A quote holding
    // an atom soft-wraps instead — the atom survives, which beats exiting the
    // quote at a boundary computed from the wrong coordinate space.
    const canSplitHere = sel.empty && !hasInlineAtom(line.content);
    if (canSplitHere && caretOnBlankVisualLine(line.textContent, offset)) {
      return splitQuoteOnBlankLine(state, ctx, dispatch);
    }
    return insertSoftBreak(state, dispatch);
  }

  // Empty list item: leave the list, converting in place to Text.
  if (LIST_NODE_NAMES.has(block.type.name) && blank) {
    const tr = convertBlockType(state.tr, blockPos, block, schema.nodes.paragraph, {
      content: 'clear',
    });
    return dispatchStructural(
      tr.setSelection(TextSelection.create(tr.doc, blockPos + 2)).scrollIntoView(),
      dispatch,
    );
  }

  // Caret at the logical start of a non-empty block: push an empty Text block
  // above and leave the caret where it was, regardless of the block's type.
  const atLogicalStart =
    sel.empty &&
    (offset === 0 || (offset === 1 && line.textContent.charCodeAt(0) === 0x200b));
  if (atLogicalStart && !blank) {
    const above = emptyTextBlock(schema);
    const tr = state.tr.insert(blockPos, above);
    tr.setSelection(TextSelection.create(tr.doc, blockPos + above.nodeSize + 2));
    return dispatchStructural(tr.scrollIntoView(), dispatch);
  }

  // General split: current block keeps its type and the text before the caret;
  // the block below gets the text after — a same-type sibling for a list, a Text
  // block for everything else (a split heading does not spawn another heading).
  const belowType = LIST_NODE_NAMES.has(block.type.name) ? block.type : schema.nodes.paragraph;
  const lineContentStart = blockPos + 2;
  const lineContentEnd = lineContentStart + line.content.size;
  const blockEnd = blockPos + block.nodeSize;

  const tr = state.tr;
  tr.replaceWith(lineContentStart, lineContentEnd, before);
  const insertAt = blockEnd - (line.content.size - before.size);
  const belowBlock = belowType.create(null, schema.nodes.line.create(null, after));
  tr.insert(insertAt, belowBlock);
  tr.setSelection(TextSelection.create(tr.doc, insertAt + 2));
  return dispatchStructural(tr.scrollIntoView(), dispatch);
};

/** Deletes the caret's empty block, focusing the previous one — but never empties the doc. */
function deleteEmptyBlock(
  state: Parameters<Command>[0],
  ctx: BlockContext,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const { block, blockPos } = ctx;
  const $block = state.doc.resolve(blockPos);
  const prev = $block.nodeBefore;
  const prevLine = prev ? lineOf(prev) : null;

  if (prev && prevLine) {
    const prevStart = blockPos - prev.nodeSize;
    const prevLineEnd = prevStart + 2 + prevLine.content.size;
    const tr = state.tr.delete(blockPos, blockPos + block.nodeSize);
    tr.setSelection(TextSelection.create(tr.doc, prevLineEnd));
    return dispatchStructural(tr.scrollIntoView(), dispatch);
  }

  // No previous sibling. Delete only if a sibling remains after us, so the
  // document never drops below one block; otherwise the last block stays put.
  if ($block.parent.childCount > 1) {
    const tr = state.tr.delete(blockPos, blockPos + block.nodeSize);
    tr.setSelection(TextSelection.create(tr.doc, blockPos + 2));
    return dispatchStructural(tr.scrollIntoView(), dispatch);
  }
  return true;
}

/** Appends the caret's block content into the previous block, which keeps its type. */
function mergeIntoPrevious(
  state: Parameters<Command>[0],
  ctx: BlockContext,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const { block, blockPos, line } = ctx;
  const $block = state.doc.resolve(blockPos);
  const prev = $block.nodeBefore;
  const prevLine = prev ? lineOf(prev) : null;
  // Nothing to merge into (first block, or a previous block with no line): the
  // desktop's MergeWithPrevious simply does nothing here. Swallow the key so a
  // stray join does not happen instead.
  if (!prev || !prevLine) return true;

  const prevStart = blockPos - prev.nodeSize;
  const prevLineEnd = prevStart + 2 + prevLine.content.size;
  // A code block's line forbids marks; drop them so the appended prose is valid.
  const content =
    prevLine.type.name === 'codeLine' ? stripMarks(line.content) : line.content;

  const tr = state.tr.delete(blockPos, blockPos + block.nodeSize);
  tr.insert(prevLineEnd, content);
  tr.setSelection(TextSelection.create(tr.doc, prevLineEnd));
  return dispatchStructural(tr.scrollIntoView(), dispatch);
}

/**
 * Backspace, but only its structural half. A collapsed caret at column 0 is the
 * one case the desktop intercepts; everywhere else this returns false and the
 * ordinary character delete happens.
 *
 * At column 0 the ladder is: an empty Text block deletes (or resets, if it is the
 * last one); an empty non-Text block de-formats to Text; a non-empty non-Text
 * block de-formats to Text keeping its content (no merge yet — that is the next
 * keystroke); and a non-empty Text block merges up into whatever precedes it.
 */
export const backspaceStructural: Command = (state, dispatch) => {
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || !sel.empty) return false;
  const ctx = blockContext(state);
  if (!ctx || ctx.offset !== 0) return false;

  const { block, blockPos, line } = ctx;
  const schema = state.schema;
  const isText = block.type.name === 'paragraph';
  const empty = isContentVisuallyEmpty(line.content);

  if (empty) {
    if (isText) return deleteEmptyBlock(state, ctx, dispatch);
    const tr = convertBlockType(state.tr, blockPos, block, schema.nodes.paragraph, {
      content: 'preserve',
    });
    tr.setSelection(TextSelection.create(tr.doc, blockPos + 2));
    return dispatchStructural(tr, dispatch);
  }

  if (isText) return mergeIntoPrevious(state, ctx, dispatch);

  // Non-empty, non-Text: de-format to Text, keep the content, do not merge.
  const tr = convertBlockType(state.tr, blockPos, block, schema.nodes.paragraph, {
    content: 'preserve',
  });
  tr.setSelection(TextSelection.create(tr.doc, blockPos + 2));
  return dispatchStructural(tr, dispatch);
};

/** The structural keybindings, in prosemirror-keymap form. */
export function structureKeyBindings(): Record<string, Command> {
  return {
    Enter: splitBlock,
    'Mod-Enter': insertSoftBreak,
    Backspace: backspaceStructural,
  };
}

/**
 * The structural keymap plugin. Mounted above the base keymap so column-0
 * Backspace and Enter are ours, while every other key — including a mid-line
 * Backspace — falls through to ProseMirror's own handling.
 */
export function structureKeymap(): Plugin {
  return keymap(structureKeyBindings());
}
