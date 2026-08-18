// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { TextSelection, type EditorState } from 'prosemirror-state';
import type { DecorationSet } from 'prosemirror-view';

import { buildNoteEditState, editorPlugins } from './build-edit-state';
import { editorSchema } from '../editor/schema';
import { block, span } from '../editor/mapper/fixtures';
import type { Block, BlockType } from '../model/types';

describe('buildNoteEditState', () => {
  it('turns ordinary blocks into a checked editable state', () => {
    const result = buildNoteEditState([
      block('Heading1', [span('Title', { bold: true })]),
      block('Text', [span('a paragraph')]),
      block('NumberedList', [span('one')]),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(() => result.state.doc.check()).not.toThrow();
    expect(result.state.doc.childCount).toBe(3);
  });

  it('seeds an empty note rather than quarantining it', () => {
    const result = buildNoteEditState([]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.doc.childCount).toBe(1);
  });

  it('quarantines unrepresentable content exactly as the read path does', () => {
    const mismatched: Block = block('Code', [span('x')], { kind: 'checklist', checked: true });
    const result = buildNoteEditState([mismatched]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.message).toBeTruthy();
  });

  it('reports an unmapped wire type as quarantine, not a crash', () => {
    const alien: Block = { ...block('Text', [span('x')]), type: 'Nonesuch' as BlockType };
    expect(buildNoteEditState([alien]).ok).toBe(false);
  });
});

describe('editorPlugins wiring', () => {
  it('wires the full stack in precedence order', () => {
    const { registry, inline } = editorSchema();
    const plugins = editorPlugins(registry, inline);
    expect(plugins).toHaveLength(23);
    // Five positions carry meaning rather than tidiness. The nested-input guard
    // has to be asked before the keymaps it stands down; the trailing-click rule
    // claims a press under the document before anything reads it as a press on
    // the nearest block; the image and clipboard plugins claim paste/copy/cut
    // before the slash menu, which itself has to be asked before the keymaps
    // since it takes the arrow keys and Enter while it is open; and the history
    // boundary has to close the undo group after the repair plugins have appended
    // into it, so it is last among the plugins that ordering governs. The
    // formatting toolbar trails everything: it has no keymap and no
    // `appendTransaction`, only a `view()`, so its place is exempt from the
    // precedence this test checks.
    expect(plugins[0].props.handleDOMEvents?.keydown).toBeTypeOf('function');
    expect(plugins[1].props.handleDOMEvents?.mousedown).toBeTypeOf('function');
    expect(plugins[2].props.handlePaste).toBeTypeOf('function');
    expect(plugins[3].props.handleDOMEvents?.copy).toBeTypeOf('function');
    expect(plugins[4].props.handleKeyDown).toBeTypeOf('function');
    expect(plugins.at(-1)?.spec.view).toBeTypeOf('function');
    expect(plugins.at(-2)?.spec.appendTransaction).toBeTypeOf('function');
  });

  it('gives a block created by an edit its own identity', () => {
    const result = buildNoteEditState([block('Text', [span('hi')])]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const bare = result.state.schema.nodes.paragraph.create(
      null,
      result.state.schema.nodes.line.create(),
    );
    const next = result.state.apply(result.state.tr.insert(result.state.doc.content.size, bare));

    // Without this the block would be committed with an empty sid, be assigned
    // one by the server, and be assigned a *different* one on the next save, 
    // forever, since a commit answers with a version and nothing else.
    const created = next.doc.child(next.doc.childCount - 1);
    expect(String(created.attrs.sid)).not.toBe('');
    expect(String(created.attrs.id)).not.toBe('');
  });

  it('runs the invariant pipeline on an edit, text typed into a heading turns bold', () => {
    const result = buildNoteEditState([block('Heading2', [span('hi')])]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // End of the heading's "hi": block at 0, content opens at 2, two chars in.
    const next = result.state.apply(result.state.tr.insertText('!', 4));
    const heading = next.doc.firstChild!;
    expect(heading.textContent).toBe('hi!');
    let allBold = true;
    heading.firstChild!.forEach((child) => {
      if (child.isText && !child.marks.some((m) => m.type.name === 'strong')) allBold = false;
    });
    expect(allBold).toBe(true);
  });

  it('wires the numbered-list decoration so ordered items get numbers', () => {
    const result = buildNoteEditState([
      block('NumberedList', [span('a')]),
      block('NumberedList', [span('b')]),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Several plugins expose decorations (block selection, find highlights, list
    // numbers, reserved heights). Of those, block selection and find paint
    // nothing on a plain document, and the list-number plugin runs before the
    // size plugin, so the first non-empty set is the list numbers.
    const state = result.state;
    const decorated = state.plugins
      .filter((p) => p.props && (p.props as { decorations?: unknown }).decorations)
      .map((p) =>
        (p.props as unknown as { decorations(s: EditorState): DecorationSet | undefined }).decorations(state),
      )
      .filter((set): set is DecorationSet => set != null && set.find().length > 0);
    expect(decorated[0].find()).toHaveLength(2);
  });

  it('wires the markdown input trigger so "# " converts a paragraph to a heading', () => {
    const result = buildNoteEditState([block('Text', [span('#')])]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const inputPlugin = result.state.plugins.find(
      (p) => p.props && (p.props as { handleTextInput?: unknown }).handleTextInput,
    );
    expect(inputPlugin).toBeDefined();

    // Drive the trigger the way a view would: caret after "#", type a space.
    const caret = 3; // block at 0, content opens at 2, one char in
    const withCaret = result.state.apply(
      result.state.tr.setSelection(TextSelection.create(result.state.doc, caret)),
    );
    const view = {
      state: withCaret,
      dispatch(tr: import('prosemirror-state').Transaction) {
        view.state = view.state.apply(tr);
      },
    };
    const handled = (
      inputPlugin!.props as unknown as {
        handleTextInput(v: typeof view, from: number, to: number, text: string): boolean;
      }
    ).handleTextInput(view, caret, caret, ' ');
    expect(handled).toBe(true);
    expect(view.state.doc.firstChild!.type.name).toBe('heading');
  });
});
