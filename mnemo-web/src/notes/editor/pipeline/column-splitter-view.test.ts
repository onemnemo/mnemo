// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { block, span } from '../mapper/fixtures';
import type { Block } from '../../model/types';
import { mountEditor, type MountedEditor } from '../view/mount';

const mounted: MountedEditor[] = [];

afterEach(() => {
  for (const editor of mounted.splice(0)) {
    const host = editor.view.dom.parentElement;
    editor.destroy();
    host?.remove();
  }
});

function split(left: string, right: string): Block {
  const lane = (text: string) => block('ColumnGroup', [span('')], { kind: 'empty' }, { children: [block('Text', [span(text)])] });
  return block('TwoColumn', [span('')], { kind: 'twoColumn', splitRatio: 0.5 }, { children: [lane(left), lane(right)] });
}

function mount(blocks: Block[]) {
  const built = buildNoteEditState(blocks);
  if (!built.ok) throw new Error('fixture did not build');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = mountEditor({ mount: host, state: built.state, registry: built.registry });
  mounted.push(editor);
  return editor.view;
}

function splitters(view: MountedEditor['view']): HTMLElement[] {
  return [...view.dom.querySelectorAll<HTMLElement>('.notes-column-splitter')];
}

describe('the column splitter widget', () => {
  it('keeps its element when text is typed above the split', () => {
    const view = mount([block('Text', [span('top')]), split('L', 'R'), split('A', 'B')]);
    const before = splitters(view);

    for (let i = 0; i < 5; i++) view.dispatch(view.state.tr.insertText('x', 2));

    const after = splitters(view);
    expect(after).toHaveLength(2);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    for (const el of after) {
      expect(el.previousElementSibling?.matches('[data-column]')).toBe(true);
      expect(el.nextElementSibling?.matches('[data-column]')).toBe(true);
    }
  });

  it('commits a drag to its own split after the document moved under it', () => {
    const view = mount([block('Text', [span('top')]), split('L', 'R')]);
    const [splitter] = splitters(view);
    const container = splitter.closest<HTMLElement>('[data-two-column]')!;
    container.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 10, right: 200, bottom: 10, x: 0, y: 0, toJSON: () => ({}) });

    splitter.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100 }));
    view.dispatch(view.state.tr.insertText('typed ', 2));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 60 }));

    const twoColumn = view.state.doc.child(1);
    expect(twoColumn.type.name).toBe('twoColumn');
    expect(Number(twoColumn.attrs.splitRatio)).toBeCloseTo(0.3);
    expect(splitters(view)[0]).toBe(splitter);
  });
});
