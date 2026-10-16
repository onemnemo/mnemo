// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EditorView } from 'prosemirror-view';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { redo, undo } from '../history';
import { block, span } from '../mapper/fixtures';

let view: EditorView | null = null;
let mount: HTMLElement | null = null;

function open(caption: string): EditorView {
  const built = buildNoteEditState([
    block('Code', [span('let x = 1;')], { kind: 'code', language: 'ts', source: 'let x = 1;', caption }),
  ]);
  if (!built.ok) throw new Error('fixture did not build');
  mount = document.createElement('div');
  document.body.appendChild(mount);
  view = new EditorView(mount, { state: built.state });
  return view;
}

const captionOf = (editor: EditorView): string => String(editor.state.doc.child(0).attrs.caption);

function setCaption(editor: EditorView, caption: string): void {
  editor.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { ...editor.state.doc.child(0).attrs, caption }));
}

afterEach(() => {
  view?.destroy();
  mount?.remove();
  view = null;
  mount = null;
});

describe('a code block caption in the undo history', () => {
  it('opens with the stored caption', () => {
    expect(captionOf(open('Figure one'))).toBe('Figure one');
  });

  it('undoes and redoes an added caption', () => {
    const editor = open('');
    setCaption(editor, 'Figure one');
    undo(editor.state, editor.dispatch);
    expect(captionOf(editor)).toBe('');
    redo(editor.state, editor.dispatch);
    expect(captionOf(editor)).toBe('Figure one');
  });

  it('undoes and redoes a changed caption', () => {
    const editor = open('old');
    setCaption(editor, 'new');
    undo(editor.state, editor.dispatch);
    expect(captionOf(editor)).toBe('old');
    redo(editor.state, editor.dispatch);
    expect(captionOf(editor)).toBe('new');
  });

  it('undoes and redoes a removed caption', () => {
    const editor = open('kept');
    setCaption(editor, '');
    undo(editor.state, editor.dispatch);
    expect(captionOf(editor)).toBe('kept');
    redo(editor.state, editor.dispatch);
    expect(captionOf(editor)).toBe('');
  });
});
