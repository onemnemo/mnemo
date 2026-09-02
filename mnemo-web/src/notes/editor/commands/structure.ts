/**
 * The structural editing commands: Enter (split), Backspace (merge / de-format),
 * the horizontal arrows across an image caption, and the in-place block type
 * conversion the first two lean on.
 *
 * These port the Avalonia `KeyboardHandler` + `HandleEnterPressed` +
 * `QuoteEnterBehavior` decision tree, which is where the editor's whole feel
 * lives. Two properties of that port are load-bearing:
 *
 *  - **Type conversion never re-mints identity.** Changing a block's type is a
 *    `setNodeMarkup` (or a line-kind-preserving rebuild) that carries `id`, `sid`,
 *    `order` and `meta` across unchanged. A delete-and-reinsert would hand the
 *    block a fresh `sid`, and a re-minted sid is one the AI has already named in
 *    chat history, the exact loss the sid contract exists to prevent.
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
import { blockChildrenOf, containerBlockNames, isListItem, lineIsCaretTarget, lineOf } from '../blocks/shared';
import { asOwnUndoStep } from '../history';
import { blockContext, type BlockContext } from './caret-block';
import { isNested, outdentTransaction } from './list-nesting';
import { backspaceAtCellStart, cellStartContext } from './two-column';

export { blockContext, type BlockContext } from './caret-block';

/** Earlier builds stored a U+200B in empty paragraphs; it is never visible text. */
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

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
 * An equation contributes no text, it holds a position and renders from its
 * attrs, so a line containing nothing but one reads as blank to
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
 * and a content position disagree, so anything cutting content at an offset
 * derived from text has to check this first.
 */
export function hasInlineAtom(content: Fragment): boolean {
  let found = false;
  content.forEach((child) => {
    if (!child.isText) found = true;
  });
  return found;
}

/**
 * Dispatch a structural edit: one press, one undo step.
 *
 * Every command here except {@link insertSoftBreak} goes through this. A split, a
 * merge, a delete, a de-format, the desktop pushed each as its own
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
 * The line node a block type wants for its inline content, `codeLine` for the
 * source blocks, `line` for everyone else. Read off the type's own content
 * expression rather than a hardcoded name list, so a new source block type is
 * handled the day it is added.
 */
function lineTypeFor(type: NodeType): NodeType {
  const { codeLine, line } = type.schema.nodes;
  return type.contentMatch.matchType(codeLine) ? codeLine : line;
}

/** A fresh, identity-less empty Text block, what an insert-above drops in. */
function emptyTextBlock(schema: NodeType['schema']): PMNode {
  return schema.nodes.paragraph.create(null, schema.nodes.line.create());
}

/** Re-wraps inline content with no marks, for insertion into a mark-forbidding codeLine. */
export function stripMarks(content: Fragment): Fragment {
  const out: PMNode[] = [];
  content.forEach((child) => out.push(child.mark(Mark.none)));
  return Fragment.fromArray(out);
}

/**
 * Convert the block at `pos` to `targetType` in place, preserving identity.
 *
 * When the line kind does not change (the common case, every prose type shares
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
 * Insert a literal newline at the caret. This is the Shift+Enter and
 * Ctrl/Cmd+Enter behaviour everywhere, and the plain-Enter behaviour inside
 * code (multi-line source) and inside a quote whose current line still has
 * text (a soft wrap, not an exit).
 */
export const insertSoftBreak: Command = (state, dispatch) => {
  // The same gate splitBlock keeps: over a node selection the insert would
  // REPLACE the selected block with the newline, so only text takes the break.
  if (!(state.selection instanceof TextSelection)) return false;
  const { from, to } = state.selection;
  if (dispatch) dispatch(state.tr.insertText('\n', from, to).scrollIntoView());
  return true;
};

/** `text.LastIndexOf('\n', caret-1)+1` .. next `\n`, the visual line the caret is on. */
function visualLineBounds(text: string, caret: number): { start: number; endExcl: number } {
  const start = caret === 0 ? 0 : text.lastIndexOf('\n', caret - 1) + 1;
  const nl = text.indexOf('\n', start);
  return { start, endExcl: nl < 0 ? text.length : nl };
}

/** Whether the caret sits on a whitespace-only visual line, the quote exit trigger. */
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

  // Trailing \r\n before the blank line belongs to neither side, trim it off the body.
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
 * everything else splits, lists into a same-type sibling, all else into Text.
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

  // A caret in a container's structural line has no block to split; swallow
  // the key rather than let the generic path treat the container as one.
  if (containerBlockNames.has(block.type.name)) return true;

  // A table cell holds one run of prose, so Enter is a line break inside the cell,
  // never a block split. The generic split would insert a sibling block at the
  // row level, which the row cannot hold, and the isolating table tears open
  // around the misfit. Tab is how the caret leaves a cell; Enter stays in it.
  if (block.type.name === 'tableCell') return insertSoftBreak(state, dispatch);

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
    // an atom soft-wraps instead, the atom survives, which beats exiting the
    // quote at a boundary computed from the wrong coordinate space.
    const canSplitHere = sel.empty && !hasInlineAtom(line.content);
    if (canSplitHere && caretOnBlankVisualLine(line.textContent, offset)) {
      return splitQuoteOnBlankLine(state, ctx, dispatch);
    }
    return insertSoftBreak(state, dispatch);
  }

  // Empty list item: leave the list. A nested one steps out one level first and
  // keeps its type, so a run of Enters walks back up to the top before the last
  // one turns the item into Text.
  if (isListItem(block) && blank) {
    if (isNested(state, blockPos)) {
      const lifted = outdentTransaction(state, blockPos, block);
      if (lifted) {
        // The lifted item opens one position later, past its parent's closing token.
        lifted.setSelection(TextSelection.create(lifted.doc, blockPos + 3));
        return dispatchStructural(lifted.scrollIntoView(), dispatch);
      }
    }
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
  // the block below gets the text after, a same-type sibling for a list, a Text
  // block for everything else (a split heading does not spawn another heading).
  const belowType = isListItem(block) ? block.type : schema.nodes.paragraph;
  const lineContentStart = blockPos + 2;
  const lineContentEnd = lineContentStart + line.content.size;
  const blockEnd = blockPos + block.nodeSize;

  const tr = state.tr;
  tr.replaceWith(lineContentStart, lineContentEnd, before);
  // A block with a nested list beneath it puts the new block at the head of that
  // list rather than after it: the caret was on the parent's line, and the block
  // that appears has to be the next one the eye reaches, not one below every
  // child. The head is the position right after the line's closing token.
  const insertAt =
    blockChildrenOf(block).length > 0
      ? lineContentStart + before.size + 1
      : blockEnd - (line.content.size - before.size);
  const belowBlock = belowType.create(null, schema.nodes.line.create(null, after));
  tr.insert(insertAt, belowBlock);
  tr.setSelection(TextSelection.create(tr.doc, insertAt + 2));
  return dispatchStructural(tr.scrollIntoView(), dispatch);
};

/**
 * The block whose line comes right before `blockPos` in document order: the
 * previous sibling's deepest last item when that sibling holds a nested list,
 * else the sibling itself, or, for the first child of a list item, the item,
 * whose line is the one directly above. Null at the start of a run whose parent
 * holds no line of its own, the document or a column cell.
 */
function precedingLineBlock(doc: PMNode, blockPos: number): { node: PMNode; pos: number } | null {
  const $block = doc.resolve(blockPos);
  const before = $block.nodeBefore;
  if (before && !before.isTextblock) {
    let node = before;
    let pos = blockPos - before.nodeSize;
    // The line the eye sees directly above is the last one of the block's
    // nested list, however deep it goes. A container is never entered: its
    // cells are their own merge world, and a caret target it is not.
    for (;;) {
      if (containerBlockNames.has(node.type.name)) break;
      const children = blockChildrenOf(node);
      const last = children[children.length - 1];
      if (!last) break;
      pos = pos + node.nodeSize - 1 - last.nodeSize;
      node = last;
    }
    return { node, pos };
  }
  // Nothing but the parent's own line precedes us. The parent is the target when
  // it is a block the caret can sit in, a list item holding its sub-list; a
  // container's line is scenery and never a merge target.
  if ($block.depth >= 1 && !containerBlockNames.has($block.parent.type.name)) {
    return { node: $block.parent, pos: $block.before($block.depth) };
  }
  return null;
}

/**
 * The block whose line comes right after the caret's block in document order:
 * its first child when it holds a nested list, else its next sibling, else, at
 * the end of a list item's sub-list, whatever follows that item, climbing as far
 * as list items go. Null at the end of the document or of a container.
 */
function followingLineBlock(doc: PMNode, ctx: BlockContext): { node: PMNode; pos: number } | null {
  const children = blockChildrenOf(ctx.block);
  if (children.length > 0) return { node: children[0], pos: ctx.blockPos + 1 + ctx.line.nodeSize };
  let pos = ctx.blockPos;
  let node = ctx.block;
  for (;;) {
    const afterPos = pos + node.nodeSize;
    const $after = doc.resolve(afterPos);
    const next = $after.nodeAfter;
    if (next) return { node: next, pos: afterPos };
    if ($after.depth < 1 || !isListItem($after.parent)) return null;
    node = $after.parent;
    pos = $after.before($after.depth);
  }
}

/**
 * Deletes the caret's empty block, focusing the line above it, but never empties
 * the doc. A block holding a nested list is dissolved rather than deleted: its
 * children take its place, keeping their position and losing one level, and
 * the caret still lands on the line above.
 */
function deleteEmptyBlock(
  state: Parameters<Command>[0],
  ctx: BlockContext,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const { block, blockPos } = ctx;
  const target = precedingLineBlock(state.doc, blockPos);
  const children = blockChildrenOf(block);

  if (target) {
    const targetLine = lineOf(target.node);
    // A previous block exists but is not somewhere the caret can land: a
    // divider, a table, an atom drawing from its payload. Deleting our empty
    // block would strand the caret in scenery the user cannot see or reach, so
    // swallow the key instead, the same as when there is no previous block at
    // all.
    if (!targetLine || !lineIsCaretTarget(target.node.type)) return true;
    const targetLineEnd = target.pos + 2 + targetLine.content.size;
    const tr = state.tr.replaceWith(blockPos, blockPos + block.nodeSize, children);
    tr.setSelection(TextSelection.create(tr.doc, targetLineEnd));
    return dispatchStructural(tr.scrollIntoView(), dispatch);
  }

  // No line above. Delete only if a block remains after us, a sibling or our
  // own promoted children, so the document never drops below one block;
  // otherwise the last block stays put.
  const $block = state.doc.resolve(blockPos);
  if ($block.parent.childCount > 1 || children.length > 0) {
    const tr = state.tr.replaceWith(blockPos, blockPos + block.nodeSize, children);
    tr.setSelection(TextSelection.create(tr.doc, blockPos + 2));
    return dispatchStructural(tr.scrollIntoView(), dispatch);
  }
  return true;
}

/**
 * Appends the caret's block content into the block whose line precedes it,
 * which keeps its type. The absorbed block's own nested list stays exactly where
 * it was in document order: a parent that melts into the block above hands that
 * block its children, and a first child that melts into its parent leaves its
 * children at the head of the parent's list.
 */
function mergeIntoPrevious(
  state: Parameters<Command>[0],
  ctx: BlockContext,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const { block, blockPos, line } = ctx;
  const target = precedingLineBlock(state.doc, blockPos);
  const targetLine = target ? lineOf(target.node) : null;
  // Nothing to merge into: no line above, or one that is not somewhere the
  // caret can land (a divider, a table, an atom drawing from its payload).
  // Merging into one of those would write the caret's text into a line the user
  // can never see or reach again, though it would still be sitting there on
  // save. The desktop's MergeWithPrevious does nothing here either; swallow the
  // key so a stray join does not happen instead.
  if (!target || !targetLine || !lineIsCaretTarget(target.node.type)) return true;

  const targetLineEnd = target.pos + 2 + targetLine.content.size;
  // A code block's line forbids marks; drop them so the appended prose is valid.
  const content =
    targetLine.type.name === 'codeLine' ? stripMarks(line.content) : line.content;
  const children = blockChildrenOf(block);
  // The children follow the text: into the target's own list, at its end, so
  // they stay indented under the line they now belong to. When the target is
  // our parent that end would put them after our former siblings, so there they
  // keep our slot instead, right after the parent's line.
  const isParent = target.pos < blockPos && blockPos < target.pos + target.node.nodeSize;
  const childrenAt = isParent ? blockPos : target.pos + target.node.nodeSize - 1;

  const tr = state.tr.delete(blockPos, blockPos + block.nodeSize);
  if (children.length > 0) tr.insert(childrenAt, children);
  tr.insert(targetLineEnd, content);
  tr.setSelection(TextSelection.create(tr.doc, targetLineEnd));
  return dispatchStructural(tr.scrollIntoView(), dispatch);
}

/**
 * Backspace, but only its structural half. A collapsed caret at column 0 is the
 * one case the desktop intercepts; everywhere else this returns false and the
 * ordinary character delete happens.
 *
 * At column 0 the ladder is: an empty Text block deletes (or resets, if it is the
 * last one); an empty non-Text block de-formats to Text; a non-empty non-Text
 * block de-formats to Text keeping its content (no merge yet, that is the next
 * keystroke); and a non-empty Text block merges up into whatever precedes it.
 */
export const backspaceStructural: Command = (state, dispatch) => {
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || !sel.empty) return false;
  const ctx = blockContext(state);
  if (!ctx || ctx.offset !== 0) return false;

  const { block, blockPos, line } = ctx;
  const schema = state.schema;

  // Same guard as the split: a container is never the caret's block, and the
  // de-format branch below would otherwise try to convert it to Text.
  if (containerBlockNames.has(block.type.name)) return true;

  // A table cell is not a formattable block: the de-format branch below would
  // convert it to a paragraph, which is invalid inside its row and throws. At
  // column 0 there is nothing to merge into either (the row's cells are
  // isolating), so Backspace does nothing structural here; ordinary character
  // deletion (offset > 0, handled before this command) is unaffected.
  if (block.type.name === 'tableCell') return true;

  const isText = block.type.name === 'paragraph';
  const empty = isContentVisuallyEmpty(line.content);

  // The image ladder is its own, per the desktop: a block holding a picture or a
  // caption swallows the key and never merges or de-formats, because the generic
  // branch below would flatten it to a paragraph and lose the stored reference
  // in one keystroke. An empty placeholder deletes in one step; as the
  // document's last block it resets to Text in place, like the empty-Text rule.
  if (block.type.name === 'image') {
    if (String(block.attrs.path ?? '') !== '' || !empty) return true;
    const $block = state.doc.resolve(blockPos);
    if ($block.nodeBefore !== null || $block.parent.childCount > 1) {
      return deleteEmptyBlock(state, ctx, dispatch);
    }
    const tr = convertBlockType(state.tr, blockPos, block, schema.nodes.paragraph, {
      content: 'clear',
    });
    tr.setSelection(TextSelection.create(tr.doc, blockPos + 2));
    return dispatchStructural(tr, dispatch);
  }

  if (isText) {
    // At the start of a Text block that is the first block in a column cell,
    // Backspace merges out of the cell and, when that empties the cell,
    // dissolves the split, the same as the desktop's merge-with-previous. A
    // formatted first block de-formats first (the branch below), so only a plain
    // Text block reaches the split here.
    const cell = cellStartContext(state);
    if (cell) return backspaceAtCellStart(state, ctx, cell, dispatch);
    if (empty) return deleteEmptyBlock(state, ctx, dispatch);
    return mergeIntoPrevious(state, ctx, dispatch);
  }

  // Non-empty or empty non-Text: de-format to Text, keep the content, do not merge.
  const tr = convertBlockType(state.tr, blockPos, block, schema.nodes.paragraph, {
    content: 'preserve',
  });
  tr.setSelection(TextSelection.create(tr.doc, blockPos + 2));
  return dispatchStructural(tr, dispatch);
};

/**
 * Forward Delete, but only its structural half, the mirror of
 * {@link backspaceStructural}: a collapsed caret at the end of its line is the
 * one case intercepted here; everywhere else this returns false and the
 * ordinary character delete happens.
 *
 * Left unhandled, ProseMirror's own `Delete` binding runs `joinForward`
 * instead, which cannot see this schema's `"line block*"` shape: `line` is
 * not itself a member of the `block` group, so its generic join finds no
 * content match and falls back to re-parenting the next block as a *child*
 * of this one rather than merging their text. That corrupts structure on the
 * single most ordinary use of the key, joining two paragraphs.
 *
 * The ladder mirrors Backspace's own asymmetry rather than inventing a new
 * one: Backspace only ever melts its *own* block into whatever precedes it,
 * and only when that block is Text, other block types de-format instead of
 * merging. Delete applies the same rule to the block ahead: only a following
 * Text block ever merges in, keeping this block's own type, because Text is
 * the only shape allowed to disappear into a neighbor of any other kind. A
 * divider, a table, or another non-Text block next door swallows the key,
 * never nested and never silently reformatted.
 */
export const deleteForwardStructural: Command = (state, dispatch) => {
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || !sel.empty) return false;
  const ctx = blockContext(state);
  if (!ctx || ctx.offset !== ctx.line.content.size) return false;

  const { block, blockPos, line } = ctx;

  // Same guards as Backspace: a container is never the caret's block, a
  // table cell has nothing to join across its isolating boundary, and an
  // image or its caption never merges or de-formats in either direction.
  if (containerBlockNames.has(block.type.name)) return true;
  if (block.type.name === 'tableCell') return true;
  if (block.type.name === 'image') return true;

  const following = followingLineBlock(state.doc, ctx);
  if (!following || following.node.type.name !== 'paragraph') return true;
  const next = following.node;

  const nextLine = lineOf(next);
  if (!nextLine) return true;

  const lineContentEnd = blockPos + 2 + line.content.size;
  // A code block's line forbids marks; drop them so the appended prose is valid.
  const content = line.type.name === 'codeLine' ? stripMarks(nextLine.content) : nextLine.content;
  // The absorbed block's nested list keeps its slot, as Backspace leaves it:
  // what follows the joined text is what followed the block.
  const children = blockChildrenOf(next);

  const tr = state.tr.delete(following.pos, following.pos + next.nodeSize);
  if (children.length > 0) tr.insert(following.pos, children);
  tr.insert(lineContentEnd, content);
  tr.setSelection(TextSelection.create(tr.doc, lineContentEnd));
  return dispatchStructural(tr.scrollIntoView(), dispatch);
};

/**
 * The caption line's content start, given the position just before an image block.
 *
 * The block opens at `pos`, its mandatory line opens one further in, and the line's content
 * begins one after that, the same base every command here measures a line from.
 */
function captionStart(pos: number): number {
  return pos + 2;
}

/**
 * ArrowRight at the very end of the block before a picture: into that picture's caption.
 *
 * Document order says the caption comes next and the browser cannot agree while the line is
 * empty. An empty caption is clipped (no height, no ink), so Chromium finds no next visible
 * caret position and the key does nothing at all, which is a dead key rather than a skip.
 * Deriving the target from the node instead of from the DOM is what makes the clipped line
 * reachable again; the caret-reveal decoration then puts it on screen.
 *
 * Claimed by position alone, whether or not the caption holds text. A caption with text is
 * where the caret was going anyway, so the binding costs that case nothing and there is no
 * emptiness test to disagree with the CSS. ArrowUp and ArrowDown are deliberately left
 * unbound: vertical motion follows visual lines, a clipped line is not one of them, and
 * stepping over the whole picture is what a reader means by "down" here.
 */
export const arrowRightIntoCaption: Command = (state, dispatch) => {
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || !sel.empty) return false;
  const ctx = blockContext(state);
  if (!ctx || ctx.offset !== ctx.line.content.size) return false;

  // The next sibling in whatever holds this block, so an image inside a column cell is
  // found by the same arithmetic as one at the top level.
  const afterPos = ctx.blockPos + ctx.block.nodeSize;
  const next = state.doc.resolve(afterPos).nodeAfter;
  if (!next || next.type.name !== 'image') return false;

  if (dispatch) {
    const tr = state.tr.setSelection(TextSelection.create(state.doc, captionStart(afterPos)));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** ArrowLeft at the very start of the block after a picture: to the end of its caption. */
export const arrowLeftIntoCaption: Command = (state, dispatch) => {
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || !sel.empty) return false;
  const ctx = blockContext(state);
  if (!ctx || ctx.offset !== 0) return false;

  const prev = state.doc.resolve(ctx.blockPos).nodeBefore;
  if (!prev || prev.type.name !== 'image') return false;
  const prevLine = lineOf(prev);
  if (!prevLine) return false;

  const at = captionStart(ctx.blockPos - prev.nodeSize) + prevLine.content.size;
  if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, at)).scrollIntoView());
  return true;
};

/** The structural keybindings, in prosemirror-keymap form. */
export function structureKeyBindings(): Record<string, Command> {
  return {
    Enter: splitBlock,
    // Two chords, one meaning: Shift+Enter is the web convention and
    // Ctrl/Cmd+Enter is the desktop's, the same pairing the chat composer keeps.
    'Shift-Enter': insertSoftBreak,
    'Mod-Enter': insertSoftBreak,
    Backspace: backspaceStructural,
    Delete: deleteForwardStructural,
    // Document-order traversal the browser cannot do on its own, and only across an image
    // boundary; every other caret is declined and moves natively.
    ArrowRight: arrowRightIntoCaption,
    ArrowLeft: arrowLeftIntoCaption,
  };
}

/**
 * The structural keymap plugin. Mounted above the base keymap so column-0
 * Backspace, end-of-line Delete, Enter, and the two arrows that step across an
 * image boundary are ours, while every other key, including a mid-line
 * Backspace or Delete and every other caret motion, falls through to
 * ProseMirror's own handling.
 */
export function structureKeymap(): Plugin {
  return keymap(structureKeyBindings());
}
