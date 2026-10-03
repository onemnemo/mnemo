// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { Selection, TextSelection, type EditorState } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import { createMarkdownSerializer } from '../mapper/serialize-markdown';
import { editorSchema } from '../schema';
import { buildCopySlice } from '../../clipboard/copy';
import { clearStashedSlice } from '../../clipboard/internal-buffer';
import { handleInternalPaste } from '../../clipboard/paste';
import { buildDeleteSelected } from '../../selection/delete-selected';
import { storedListStart } from '../blocks/list-start';
import {
  bufferedClipboard,
  caretIn,
  itemAt,
  labels,
  mount,
  numbered,
  selectBlocks,
  starts,
  text,
  viewOf,
} from './list-start-fixtures';

afterEach(() => clearStashedSlice());

/** The markdown a block copy puts on the clipboard as plain text. */
function plainText(built: ReturnType<typeof mount>, content: Parameters<ReturnType<typeof createMarkdownSerializer>['fragment']>[0]): string {
  return createMarkdownSerializer(built.registry, editorSchema().inline, { emptyParagraph: 'blank', splitRunsAtStarts: true }).fragment(content);
}

/** The start of each list a CommonMark reader finds at the top of `md`. */
function listStarts(md: string): (number | null | undefined)[] {
  return unified()
    .use(remarkParse)
    .parse(md)
    .children.flatMap((node) => (node.type === 'list' ? [node.start] : []));
}

function paste(state: EditorState, built: ReturnType<typeof mount>, copy: NonNullable<ReturnType<typeof buildCopySlice>>): EditorState {
  let next = state;
  const view = viewOf(() => next, (s) => (next = s));
  expect(handleInternalPaste(view, bufferedClipboard(copy), built.registry)).toBe(true);
  return next;
}

describe('a Mnemo copy and paste of numbered items', () => {
  it('writes the numbers shown and pastes them back as 10 and 11', () => {
    const blocks = [numbered('eight', 8), numbered('nine'), numbered('ten'), numbered('eleven'), text('end')];
    const built = mount(blocks);
    let state = selectBlocks(built.state, [blocks[2].sid, blocks[3].sid]);
    const copy = buildCopySlice(state, built.registry)!;
    expect(plainText(built, copy.slice.content)).toBe('10. ten\n11. eleven');

    state = state.apply(state.tr.setSelection(Selection.atEnd(state.doc)));
    state = paste(state, built, copy);
    expect(labels(state)).toEqual(['8', '9', '10', '11', '10', '11']);
  });

  it('joins the numbering of a run it is pasted into', () => {
    const blocks = [numbered('eight', 8), numbered('nine'), numbered('ten'), text('gap'), numbered('one'), numbered('two')];
    const built = mount(blocks);
    let state = selectBlocks(built.state, [blocks[1].sid, blocks[2].sid]);
    const copy = buildCopySlice(state, built.registry)!;
    state = paste(caretIn(state, 'one', 3), built, copy);
    expect(labels(state).slice(3)).toEqual(['1', '2', '3', '4']);
  });

  it('gives an item pasted over the selected first item the start that item had', () => {
    const blocks = [numbered('eight', 8), numbered('nine'), numbered('ten'), text('gap'), numbered('one')];
    const built = mount(blocks);
    const copy = buildCopySlice(selectBlocks(built.state, [blocks[4].sid]), built.registry)!;
    const state = paste(selectBlocks(built.state, [blocks[0].sid]), built, copy);
    expect(labels(state)).toEqual(['8', '9', '10', '1']);
    expect(starts(state)).toEqual({ one: 8 });
  });

  it('round-trips a cut of the first item pasted back where it was', () => {
    const blocks = [numbered('eight', 8), numbered('nine'), numbered('ten'), text('end')];
    const built = mount(blocks);
    let state = selectBlocks(built.state, [blocks[0].sid]);
    const copy = buildCopySlice(state, built.registry)!;
    state = state.apply(buildDeleteSelected(state, built.registry, new Set([blocks[0].sid]))!);
    expect(labels(state)).toEqual(['9', '10']);

    state = paste(state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2))), built, copy);
    expect(state.doc.firstChild!.firstChild!.textContent).toBe('eight');
    expect(labels(state)).toEqual(['8', '9', '10']);
    expect(starts(state)).toEqual({ eight: 8 });
  });

  it('copies items picked apart as the numbers they show, as two lists a CommonMark reader numbers 9 and 11', () => {
    const blocks = [numbered('eight', 8), numbered('nine'), numbered('ten'), numbered('eleven')];
    const built = mount(blocks);
    const copy = buildCopySlice(selectBlocks(built.state, [blocks[1].sid, blocks[3].sid]), built.registry)!;
    const md = plainText(built, copy.slice.content);
    expect(md).toBe('9. nine\n\n<!-- -->\n\n11. eleven');
    expect(listStarts(md)).toEqual([9, 11]);
  });

  it('keeps a typed 1 picked after an 8 from another list', () => {
    const blocks = [numbered('eight', 8), numbered('nine'), text('gap'), numbered('one'), numbered('two')];
    const built = mount(blocks);
    const copy = buildCopySlice(selectBlocks(built.state, [blocks[0].sid, blocks[3].sid]), built.registry)!;
    const md = plainText(built, copy.slice.content);
    expect(md).toBe('8. eight\n\n<!-- -->\n\n1. one');
    expect(listStarts(md)).toEqual([8, 1]);
  });

  it('writes no list break when the picked items count on', () => {
    const blocks = [numbered('eight', 8), numbered('nine'), text('gap'), numbered('ten', 10), numbered('eleven')];
    const built = mount(blocks);
    const copy = buildCopySlice(selectBlocks(built.state, [blocks[1].sid, blocks[3].sid]), built.registry)!;
    expect(plainText(built, copy.slice.content)).toBe('9. nine\n10. ten');
  });

  it('stores the shown number on the first item of a nested run copied as text', () => {
    const blocks = [numbered('eight', 8, [numbered('x', 3), numbered('y')])];
    const built = mount(blocks);
    const y = itemAt(built.state, 'y');
    const state = built.state.apply(
      built.state.tr.setSelection(TextSelection.create(built.state.doc, y.pos + 2, y.pos + 3)),
    );
    const copy = buildCopySlice(state, built.registry)!;
    expect(copy.mode).toBe('text');
    let found: PMNode | null = null;
    copy.slice.content.descendants((node) => {
      if (node.type.name === 'numberedItem' && node.firstChild?.textContent === 'y') found = node;
      return true;
    });
    expect(storedListStart((found as PMNode | null)?.attrs.meta)).toBe(4);
  });
});
