// @vitest-environment jsdom

/**
 * The React hook, under StrictMode — whose deliberate mount/unmount/mount
 * double-invoke is exactly the teardown stress this exercises. If the
 * cleanup did not fully release the view, StrictMode would leave two editors in
 * the DOM; these assert one. Note switch and unmount are checked the same way.
 */

import { StrictMode, act, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { createDocumentMapper } from '../mapper/document';
import { editorSchema } from '../schema';
import { defaultTextStyle, type Block } from '../../model/types';
import { useEditorView } from './useEditorView';

// React's `act` refuses to run unless the environment declares itself a test one.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { schema, registry } = editorSchema();
const mapper = createDocumentMapper(schema, registry);

function stateOf(text: string, sid: string): EditorState {
  const block: Block = {
    id: `id-${sid}`,
    sid,
    type: 'Text',
    spans: [{ kind: 'text', text, style: { ...defaultTextStyle } }],
    payload: { kind: 'empty' },
    meta: {},
    order: 0,
    children: null,
  };
  const result = mapper.toDoc([block]);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  return EditorState.create({ doc: result.doc as PMNode, schema });
}

function Editor({ noteKey, state }: { noteKey: string; state: EditorState }): ReactNode {
  const { ref } = useEditorView({ key: noteKey, state, registry });
  return <div ref={ref} />;
}

/** Drives the open note from parent state, the way a real note switch would. */
function Host({ initial }: { initial: { key: string; state: EditorState } }): ReactNode {
  const [note] = useState(initial);
  return <Editor noteKey={note.key} state={note.state} />;
}

let container: HTMLElement;
let root: Root;
let disposed: boolean;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  disposed = false;
});

/** Unmount once, whether the test did it or the teardown does — roots warn on a double unmount. */
function dispose(): void {
  if (disposed) return;
  disposed = true;
  act(() => root.unmount());
}

afterEach(() => {
  dispose();
  container.remove();
});

function editors(): NodeListOf<Element> {
  return container.querySelectorAll('.ProseMirror');
}

describe('useEditorView', () => {
  it('mounts exactly one editor under StrictMode', () => {
    act(() => {
      root.render(
        <StrictMode>
          <Host initial={{ key: 'a', state: stateOf('alpha', 's0001') }} />
        </StrictMode>,
      );
    });
    expect(editors()).toHaveLength(1);
    expect(container.textContent).toContain('alpha');
  });

  it('a note switch destroys the old editor and mounts the new one', () => {
    act(() => {
      root.render(
        <StrictMode>
          <Editor noteKey="a" state={stateOf('alpha', 's0001')} />
        </StrictMode>,
      );
    });
    act(() => {
      root.render(
        <StrictMode>
          <Editor noteKey="b" state={stateOf('beta', 's0002')} />
        </StrictMode>,
      );
    });
    expect(editors()).toHaveLength(1);
    expect(container.textContent).toContain('beta');
    expect(container.textContent).not.toContain('alpha');
  });

  it('unmount releases the editor', () => {
    act(() => {
      root.render(
        <StrictMode>
          <Host initial={{ key: 'a', state: stateOf('alpha', 's0001') }} />
        </StrictMode>,
      );
    });
    dispose();
    expect(editors()).toHaveLength(0);
  });
});
