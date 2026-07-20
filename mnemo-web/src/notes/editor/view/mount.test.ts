// @vitest-environment jsdom

/**
 * The mount lifecycle: one view per note, and teardown that actually releases
 * it. These are the leak gates, exercised at the framework-free layer
 * `mountEditor` owns — the React hook adds nothing to the lifecycle it needs its
 * own coverage for beyond StrictMode wiring.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { createDocumentMapper } from '../mapper/document';
import { editorSchema } from '../schema';
import { defaultTextStyle, type Block } from '../../model/types';
import { mountEditor } from './mount';

const { schema, registry } = editorSchema();
const mapper = createDocumentMapper(schema, registry);

afterEach(() => {
  document.body.replaceChildren();
});

function container(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

function docOf(blocks: Block[]): PMNode {
  const result = mapper.toDoc(blocks);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  return result.doc;
}

function textNote(text: string, sid = 's0001'): Block {
  return {
    id: `id-${sid}`,
    sid,
    type: 'Text',
    spans: [{ kind: 'text', text, style: { ...defaultTextStyle } }],
    payload: { kind: 'empty' },
    meta: {},
    order: 0,
    children: null,
  };
}

function equationNote(latex: string): Block {
  return {
    id: 'id-eq',
    sid: 's0002',
    type: 'Text',
    spans: [
      { kind: 'text', text: 'x', style: { ...defaultTextStyle } },
      { kind: 'equation', latex, style: { ...defaultTextStyle } },
    ],
    payload: { kind: 'empty' },
    meta: {},
    order: 0,
    children: null,
  };
}

function stateOf(blocks: Block[]): EditorState {
  return EditorState.create({ doc: docOf(blocks), schema });
}

describe('mountEditor lifecycle', () => {
  it('attaches exactly one editor to the mount', () => {
    const el = container();
    mountEditor({ mount: el, state: stateOf([textNote('hello')]), registry });
    expect(el.querySelectorAll('.ProseMirror')).toHaveLength(1);
    expect(el.textContent).toContain('hello');
  });

  it('destroy removes the editor from the DOM', () => {
    const el = container();
    const mounted = mountEditor({ mount: el, state: stateOf([textNote('bye')]), registry });
    mounted.destroy();
    expect(el.querySelector('.ProseMirror')).toBeNull();
  });

  it('a note switch leaves exactly one live editor, not two', () => {
    const el = container();
    // Switching notes is destroy-then-remount into the same mount element.
    const first = mountEditor({ mount: el, state: stateOf([textNote('one')]), registry });
    first.destroy();
    mountEditor({ mount: el, state: stateOf([textNote('two')]), registry });
    expect(el.querySelectorAll('.ProseMirror')).toHaveLength(1);
    expect(el.textContent).toContain('two');
    expect(el.textContent).not.toContain('one');
  });

  it('destroy is idempotent — the StrictMode double-invoke never double-frees', () => {
    const el = container();
    const mounted = mountEditor({ mount: el, state: stateOf([textNote('x')]), registry });
    mounted.destroy();
    expect(() => mounted.destroy()).not.toThrow();
    expect(el.querySelector('.ProseMirror')).toBeNull();
  });

  it('renders a registered realized view through the adapter', () => {
    const el = container();
    mountEditor({ mount: el, state: stateOf([equationNote('a^2')]), registry });
    // The equation NodeView produced by the adapter, not PM's default toDOM.
    expect(el.querySelector('.notes-equation')).not.toBeNull();
  });

  it('the handle reads the live view state', () => {
    const el = container();
    const mounted = mountEditor({ mount: el, state: stateOf([textNote('live')]), registry });
    expect(mounted.handle.state).toBe(mounted.view.state);
  });
});
