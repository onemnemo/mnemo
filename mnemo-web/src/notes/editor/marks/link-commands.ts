/**
 * Applying, reading and removing the link mark.
 *
 * Deliberately outside `toggleFormat`'s policy table: a link needs a URL from
 * the user before there is anything to set, so it is parameterised by the
 * string a popover collects rather than fired straight off a shortcut, and a
 * collapsed caret never arms it for the next character typed the way the
 * sticky-format toggle does, typing after a link should not keep extending
 * it.
 *
 * `href` is asked of {@link isSafeUrl} on the way in, the same gate the mark's
 * own `getAttrs`/`toDOM` enforce. Checking here too is not redundant: a
 * command that skipped it could still build a mark the schema would then
 * refuse to render, an href that silently vanishes the moment the document
 * round trips through the DOM.
 */

import { TextSelection, type Command, type EditorState } from 'prosemirror-state';
import type { Mark, Node as PMNode } from 'prosemirror-model';
import { asOwnUndoStep } from '../history';
import { isSafeUrl } from '../schema/safe-url';
import { applicableRanges } from './commands';

function linkOf(marks: readonly Mark[]): Mark | undefined {
  return marks.find((m) => m.type.name === 'link');
}

/** Same mark type and the same href: two links only merge into one extent when both agree. */
function sameLink(a: Mark, b: Mark | undefined): boolean {
  return !!b && a.type === b.type && String(a.attrs.href) === String(b.attrs.href);
}

/**
 * The full run of text carrying `mark`, grown outward from `pos` one inline
 * node at a time. `nodeBefore`/`nodeAfter` already cut a text node at the
 * position and hand back only the adjacent slice with its marks intact, so
 * this needs no index or offset bookkeeping of its own, just repeated
 * resolves at the edge it is currently holding.
 */
function linkExtent(state: EditorState, pos: number, mark: Mark): { from: number; to: number } {
  let from = pos;
  let to = pos;
  for (;;) {
    const before = state.doc.resolve(from).nodeBefore;
    if (!before?.isInline || !sameLink(mark, linkOf(before.marks))) break;
    from -= before.nodeSize;
  }
  for (;;) {
    const after = state.doc.resolve(to).nodeAfter;
    if (!after?.isInline || !sameLink(mark, linkOf(after.marks))) break;
    to += after.nodeSize;
  }
  return { from, to };
}

/**
 * The href in force across the selection: the stored/inherited mark at a
 * collapsed caret, or the uniform href across a range, null when there is
 * none or it is mixed. What a link control reads to show as "on" and to
 * pre-fill an edit, the same pairing `isFormatActive`/`activeSwatchToken`
 * keep for the toggled marks, so a button can never disagree with a click.
 */
export function currentLinkHref(state: EditorState): string | null {
  if (!state.schema.marks.link) return null;
  const sel = state.selection;
  if (sel instanceof TextSelection && sel.$cursor) {
    const mark = linkOf(state.storedMarks ?? sel.$cursor.marks());
    return typeof mark?.attrs.href === 'string' ? mark.attrs.href : null;
  }
  let href: string | null = null;
  let uniform = true;
  let first = true;
  let sawInline = false;
  for (const { $from, $to } of sel.ranges) {
    state.doc.nodesBetween($from.pos, $to.pos, (node) => {
      if (!node.isInline) return true;
      sawInline = true;
      const mark = linkOf(node.marks);
      const h = typeof mark?.attrs.href === 'string' ? mark.attrs.href : null;
      if (first) {
        href = h;
        first = false;
      } else if (h !== href) {
        uniform = false;
      }
      return false;
    });
  }
  return sawInline && uniform ? href : null;
}

export function isLinkActive(state: EditorState): boolean {
  return currentLinkHref(state) !== null;
}

/**
 * Whether there is something for the link control to act on: a selection
 * with writable inline content, or a collapsed caret already inside a link
 * (the click-to-edit case). What the toolbar button enables by.
 */
export function canEditLink(state: EditorState): boolean {
  const type = state.schema.marks.link;
  if (!type) return false;
  const sel = state.selection;
  if (!(sel instanceof TextSelection)) return false;
  if (!sel.empty) return applicableRanges(state.doc, sel.ranges, type).length > 0;
  return currentLinkHref(state) !== null;
}

/**
 * Sets the link mark to `href`, over the current non-empty selection, or, for
 * a collapsed caret, over the full extent of the link it sits inside (the
 * click-to-edit case, changing the address of a link already applied). A
 * collapsed caret that is not inside a link refuses: there is no text to
 * carry a link with no URL, and nothing to grow an extent from.
 *
 * The link mark excludes itself by the schema's default (no `excludes` was
 * given, and a mark type with none excludes its own type), so `addMark` alone
 * evicts the old href and installs the new one; no separate `removeMark` is
 * needed to retarget an existing link.
 */
export function applyLink(href: string): Command {
  return (state, dispatch) => {
    const type = state.schema.marks.link;
    if (!type || !isSafeUrl(href)) return false;
    const sel = state.selection;
    if (!(sel instanceof TextSelection)) return false;

    if (!sel.empty) {
      const targets = applicableRanges(state.doc, sel.ranges, type);
      if (targets.length === 0) return false;
      if (dispatch) {
        const tr = state.tr;
        for (const { from, to } of targets) tr.addMark(from, to, type.create({ href }));
        dispatch(asOwnUndoStep(tr.scrollIntoView()));
      }
      return true;
    }

    const $cursor = sel.$cursor;
    if (!$cursor) return false;
    const mark = linkOf($cursor.marks());
    if (!mark) return false;
    if (dispatch) {
      const { from, to } = linkExtent(state, $cursor.pos, mark);
      dispatch(asOwnUndoStep(state.tr.addMark(from, to, type.create({ href })).scrollIntoView()));
    }
    return true;
  };
}

/**
 * Removes the link mark from a non-empty selection, or from the whole link a
 * collapsed caret sits inside, growing to the mark's full extent so a click
 * partway through a link removes all of it, not just the half after the
 * caret.
 */
export function removeLink(): Command {
  return (state, dispatch) => {
    const type = state.schema.marks.link;
    if (!type) return false;
    const sel = state.selection;
    if (!(sel instanceof TextSelection)) return false;

    if (!sel.empty) {
      let any = false;
      for (const { $from, $to } of sel.ranges) {
        state.doc.nodesBetween($from.pos, $to.pos, (node) => {
          if (!node.isInline) return true;
          if (linkOf(node.marks)) any = true;
          return false;
        });
      }
      if (!any) return false;
      if (dispatch) {
        let tr = state.tr;
        for (const { $from, $to } of sel.ranges) tr = tr.removeMark($from.pos, $to.pos, type);
        dispatch(asOwnUndoStep(tr.scrollIntoView()));
      }
      return true;
    }

    const $cursor = sel.$cursor;
    if (!$cursor) return false;
    const mark = linkOf($cursor.marks());
    if (!mark) return false;
    if (dispatch) {
      const { from, to } = linkExtent(state, $cursor.pos, mark);
      dispatch(asOwnUndoStep(state.tr.removeMark(from, to, type).scrollIntoView()));
    }
    return true;
  };
}

/** Re-exported so a caller that already has a document position can reuse it. */
export function linkAt(doc: PMNode, pos: number): string | null {
  const mark = linkOf(doc.resolve(pos).marks());
  return typeof mark?.attrs.href === 'string' ? mark.attrs.href : null;
}
