// @vitest-environment jsdom

/**
 * Inserting an inline equation, end to end through a mounted view: the atom the
 * command creates opens its own source editor, prefilled with the text it was
 * made from. Driven through a real `EditorView` rather than the NodeView
 * harness, because the whole point of the seam is that a command with no view
 * reaches the view that is built while its transaction is applied.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Plugin } from 'prosemirror-state';
import { createDocumentMapper } from '../mapper/document';
import { createEditorSchema } from '../schema';
import { editorPlugins } from '../../edit/build-edit-state';
import { defaultTextStyle, type Block } from '../../model/types';
import { mountEditor, type MountedEditor } from '../view/mount';
import { insertEquation } from './commands';
import { equationOpenOnInsert } from './open-on-insert';

const { schema, registry, inline } = createEditorSchema();
const mapper = createDocumentMapper(schema, registry);

let mounted: MountedEditor | null = null;

afterEach(() => {
  mounted?.destroy();
  mounted = null;
  document.body.replaceChildren();
});

/** A one-paragraph note holding `text`, mounted with its whole line selected. */
function mountWithSelection(text: string, plugins: Plugin[] = [equationOpenOnInsert()]): MountedEditor {
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

  const host = document.createElement('div');
  host.className = 'notes-doc';
  document.body.append(host);

  mounted = mountEditor({
    mount: host,
    state: EditorState.create({ doc: result.doc, schema, plugins }),
    registry,
  });

  let line = -1;
  mounted.view.state.doc.descendants((node, pos) => {
    if (line < 0 && node.type.name === 'line') line = pos;
    return line < 0;
  });
  const node = mounted.view.state.doc.nodeAt(line);
  if (!node) throw new Error('no line in fixture');
  mounted.view.dispatch(
    mounted.view.state.tr.setSelection(
      TextSelection.create(mounted.view.state.doc, line + 1, line + 1 + node.content.size),
    ),
  );
  return mounted;
}

function sourceField(): HTMLInputElement | null {
  return document.body.querySelector<HTMLInputElement>('.notes-equation-editor-source');
}

describe('inserting an inline equation', () => {
  it('opens the source editor on the atom it just created', async () => {
    const m = mountWithSelection('E=mc^2');
    insertEquation()(m.view.state, m.view.dispatch);
    // The open is deferred so the view can finish applying the transaction.
    await Promise.resolve();
    expect(sourceField()?.value).toBe('E=mc^2');
  });

  it('still opens under the whole plugin stack, whose plugins append transactions of their own', async () => {
    const m = mountWithSelection('E=mc^2', editorPlugins(registry, inline));
    insertEquation()(m.view.state, m.view.dispatch);
    await Promise.resolve();
    expect(sourceField()?.value).toBe('E=mc^2');
    // Consumed on open: a redraw of the same atom opens nothing more.
    sourceField()?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(sourceField()).toBeNull();
    m.view.dispatch(m.view.state.tr.insertText('!', m.view.state.doc.content.size - 2));
    await Promise.resolve();
    expect(sourceField()).toBeNull();
  });

  it('leaves the selected text in the atom rather than deleting it', async () => {
    const m = mountWithSelection('E=mc^2');
    insertEquation()(m.view.state, m.view.dispatch);
    await Promise.resolve();
    const atom = m.view.dom.querySelector('.notes-equation');
    expect(atom).not.toBeNull();
    expect(atom?.getAttribute('aria-label')).toBe('E=mc^2');
    expect(atom?.querySelector('.katex')).not.toBeNull();
  });

  it('opens nothing for an atom that was merely redrawn', async () => {
    const m = mountWithSelection('E=mc^2');
    insertEquation()(m.view.state, m.view.dispatch);
    await Promise.resolve();
    sourceField()?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(sourceField()).toBeNull();
    // Any later transaction rebuilds views without reopening the card.
    m.view.dispatch(m.view.state.tr.insertText('!', m.view.state.doc.content.size - 2));
    await Promise.resolve();
    expect(sourceField()).toBeNull();
  });
});
