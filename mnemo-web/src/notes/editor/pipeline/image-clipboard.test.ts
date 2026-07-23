// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import { createEditorSchema } from '../schema';
import { imageClipboardPlugin } from './image-clipboard';
import type { EditorServices } from '../registry/types';

const { schema } = createEditorSchema();

function imageFile(name = 'shot.png', type = 'image/png'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

function pasteEvent(files: File[], html = ''): ClipboardEvent {
  let prevented = false;
  return {
    clipboardData: { files, getData: () => html },
    preventDefault: () => {
      prevented = true;
    },
    get defaultPrevented() {
      return prevented;
    },
  } as unknown as ClipboardEvent;
}

function harness(uploads: Record<string, string | Error>) {
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, schema.nodes.line.create(null, schema.text('hello'))),
  ]);
  let state = EditorState.create({ schema, doc });
  // Caret inside the paragraph's line, the way a paste really arrives.
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3)));

  const dispatched: Transaction[] = [];
  const view = {
    get state() {
      return state;
    },
    isDestroyed: false,
    dispatch(tr: Transaction) {
      dispatched.push(tr);
      state = state.apply(tr);
    },
    posAtCoords: () => ({ pos: 3, inside: 0 }),
  } as unknown as EditorView;

  const services: EditorServices = {
    resolveNoteTitle: () => undefined,
    loadAssetUrl: () => Promise.reject(new Error('unused')),
    uploadAsset: (file) => {
      const outcome = uploads[file.name];
      return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
    },
  };

  const plugin = imageClipboardPlugin(services);
  return { plugin, view, dispatched, currentState: () => state };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('imageClipboardPlugin', () => {
  it('declines a paste with no image files', () => {
    const { plugin, view, dispatched } = harness({});
    const handled = plugin.props.handlePaste!.call(plugin, view, pasteEvent([]), null as never);
    expect(handled).toBe(false);
    expect(dispatched).toHaveLength(0);
  });

  it('uploads a pasted image and inserts its block after the current one, one undo step', async () => {
    const { plugin, view, dispatched, currentState } = harness({ 'shot.png': 'aaaa.png' });
    const handled = plugin.props.handlePaste!.call(plugin, view, pasteEvent([imageFile()]), null as never);
    expect(handled).toBe(true);

    await flush();
    expect(dispatched).toHaveLength(1);
    const doc = currentState().doc;
    expect(doc.childCount).toBe(2);
    expect(doc.child(1).type.name).toBe('image');
    expect(doc.child(1).attrs.path).toBe('aaaa.png');
  });

  it('keeps the surviving images when one upload fails', async () => {
    const { plugin, view, currentState } = harness({
      'a.png': 'stored-a.png',
      'b.png': new Error('too large'),
    });
    plugin.props.handlePaste!.call(plugin, view, pasteEvent([imageFile('a.png'), imageFile('b.png')]), null as never);

    await flush();
    const doc = currentState().doc;
    expect(doc.childCount).toBe(2);
    expect(doc.child(1).attrs.path).toBe('stored-a.png');
  });

  it('inserts nothing when every upload fails', async () => {
    const { plugin, view, dispatched } = harness({ 'a.png': new Error('nope') });
    plugin.props.handlePaste!.call(plugin, view, pasteEvent([imageFile('a.png')]), null as never);

    await flush();
    expect(dispatched).toHaveLength(0);
  });

  it('handles a drop at the pointer position', async () => {
    const { plugin, view, currentState } = harness({ 'drag.png': 'dddd.png' });
    const event = {
      dataTransfer: { files: [imageFile('drag.png')] },
      preventDefault: () => {},
      clientX: 10,
      clientY: 10,
    } as unknown as DragEvent;

    const handled = plugin.props.handleDrop!.call(plugin, view, event, null as never, false);
    expect(handled).toBe(true);
    await flush();
    expect(currentState().doc.child(1).type.name).toBe('image');
  });

  it('ignores non-image files', () => {
    const { plugin, view, dispatched } = harness({});
    const handled = plugin.props.handlePaste!.call(
      plugin,
      view,
      pasteEvent([imageFile('doc.pdf', 'application/pdf')]),
      null as never,
    );
    expect(handled).toBe(false);
    expect(dispatched).toHaveLength(0);
  });
});
