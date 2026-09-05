// @vitest-environment jsdom

/**
 * The keymap, at two layers: the binding map derived from the catalog (pure), and
 * a real chord firing through a mounted view. The integration case is the real
 * proof, a shortcut is not just listed, it toggles the mark when the
 * key is pressed in a live editor.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { createDocumentMapper } from '../mapper/document';
import { createEditorSchema } from '../schema';
import { defaultTextStyle, type Block } from '../../model/types';
import { COMMANDS_BY_ID, type DirectCommand } from './catalog';
import { editorKeyBindings, editorKeymap } from './keymap';

const { schema, registry } = createEditorSchema();
const mapper = createDocumentMapper(schema, registry);

afterEach(() => {
  document.body.replaceChildren();
});

function textDoc(text: string): PMNode {
  const block: Block = {
    id: 'id-1',
    sid: 's0001',
    type: 'Text',
    spans: [{ kind: 'text', text, style: { ...defaultTextStyle } }],
    payload: { kind: 'empty' },
    meta: {},
    order: 0,
    children: null,
  };
  const result = mapper.toDoc([block]);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  return result.doc;
}

/** Selection over the whole inline content of the single block. */
function wholeContent(doc: PMNode): TextSelection {
  let from = -1;
  let to = -1;
  doc.descendants((node, pos) => {
    if (node.isText) {
      if (from < 0) from = pos;
      to = pos + node.nodeSize;
    }
    return true;
  });
  return TextSelection.create(doc, from, to);
}

function anyTextHasMark(doc: PMNode, markName: string): boolean {
  let found = false;
  doc.descendants((node) => {
    if (node.isText && node.marks.some((m) => m.type === schema.marks[markName])) found = true;
    return !found;
  });
  return found;
}

describe('editorKeyBindings', () => {
  it('binds exactly the catalog shortcuts to their commands', () => {
    const bindings = editorKeyBindings();
    expect(Object.keys(bindings).sort()).toEqual(
      [
        'Mod-,',
        'Mod-.',
        'Mod-Shift-h',
        'Mod-Shift-s',
        'Mod-b',
        'Mod-e',
        'Mod-i',
        'Mod-u',
        'Mod-z',
        'Mod-y',
        // The to-do toggle, which the structural keymap claims first and falls
        // back from to the soft break.
        'Mod-Enter',
        // Redo's alias, bound but never shown as its name.
        'Mod-Shift-z',
      ].sort(),
    );
    // The binding is the very command the catalog names, same reference, so the
    // chord and the button can never run different behaviours.
    expect(bindings['Mod-b']).toBe((COMMANDS_BY_ID.get('editor.bold') as DirectCommand).run);
  });

  it('omits commands with no shortcut, swatches, equation, escape', () => {
    const bound = new Set(Object.values(editorKeyBindings()));
    expect(bound.has((COMMANDS_BY_ID.get('editor.equation') as DirectCommand).run)).toBe(false);
    expect(bound.has((COMMANDS_BY_ID.get('editor.clearMarks') as DirectCommand).run)).toBe(false);
  });

  it('refuses two commands on one chord rather than silently shadowing', () => {
    const bold = COMMANDS_BY_ID.get('editor.bold') as DirectCommand;
    const clash: DirectCommand = { ...bold, id: 'editor.other', shortcut: 'Mod-b' };
    expect(() => editorKeyBindings([bold, clash])).toThrow(/Duplicate editor shortcut/);
  });
});

describe('a chord fires through a mounted view', () => {
  function mount(text: string): EditorView {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const doc = textDoc(text);
    const state = EditorState.create({
      doc,
      schema,
      selection: wholeContent(doc),
      plugins: [editorKeymap()],
    });
    return new EditorView(el, { state });
  }

  it('Mod-b toggles bold on the selection', () => {
    const view = mount('hello');
    expect(anyTextHasMark(view.state.doc, 'strong')).toBe(false);

    const event = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true });
    const handled = view.someProp('handleKeyDown', (f) => f(view, event)) ?? false;

    expect(handled).toBe(true);
    expect(anyTextHasMark(view.state.doc, 'strong')).toBe(true);
    view.destroy();
  });

  it('an unbound chord is left for someone else to handle', () => {
    const view = mount('hello');
    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true });
    const handled = view.someProp('handleKeyDown', (f) => f(view, event)) ?? false;
    expect(handled).toBe(false);
    view.destroy();
  });
});
