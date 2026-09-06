// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
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

/**
 * The line that says where a dragged file will land.
 *
 * The document is two blocks, laid out by hand because jsdom lays nothing out,
 * and the view answers coordinates from a position the test sets. What is under
 * test is the boundary the line is drawn at and the drags it is drawn for.
 */
describe('the file drop indicator', () => {
  function box(left: number, top: number, right: number, bottom: number): DOMRect {
    return {
      x: left,
      y: top,
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
      toJSON: () => ({}),
    } as DOMRect;
  }

  function dragHarness() {
    const paragraph = (text: string) =>
      schema.nodes.paragraph.create(null, schema.nodes.line.create(null, schema.text(text)));
    const doc = schema.nodes.doc.create(null, [paragraph('first'), paragraph('second')]);
    const state = EditorState.create({ schema, doc });

    const dom = document.createElement('div');
    document.body.appendChild(dom);
    for (const index of [0, 1]) {
      const row = document.createElement('div');
      row.getBoundingClientRect = () => box(100, index * 50, 500, index * 50 + 40);
      dom.appendChild(row);
    }

    let answer = 0;
    const view = {
      state,
      editable: true,
      dom,
      posAtCoords: () => ({ pos: answer, inside: answer }),
    } as unknown as EditorView;

    const services: EditorServices = {
      resolveNoteTitle: () => undefined,
      loadAssetUrl: () => Promise.reject(new Error('unused')),
      uploadAsset: () => Promise.reject(new Error('unused')),
    };

    const plugin = imageClipboardPlugin(services);
    return {
      plugin,
      view,
      dom,
      answerFrom(pos: number) {
        answer = pos;
      },
    };
  }

  function dragEvent(over: Element | null, items: { kind: string; type: string }[]): DragEvent {
    return {
      dataTransfer: { items, types: ['Files'] },
      target: over,
      relatedTarget: null,
      clientX: 200,
      clientY: 60,
    } as unknown as DragEvent;
  }

  const picture = [{ kind: 'file', type: 'image/png' }];

  function dragOver(
    harnessed: ReturnType<typeof dragHarness>,
    over: Element | null,
    items = picture,
  ): void {
    const dragover = harnessed.plugin.props.handleDOMEvents!.dragover!;
    dragover.call(harnessed.plugin, harnessed.view, dragEvent(over, items));
  }

  function drawn(): HTMLElement | null {
    return document.querySelector('.notes-drop-line');
  }

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('draws the line under the block the drop would land after', () => {
    const harnessed = dragHarness();
    // Inside the first paragraph's line, where a drop over the first block lands.
    harnessed.answerFrom(3);
    dragOver(harnessed, harnessed.dom.children[0]);

    const line = drawn();
    expect(line).not.toBeNull();
    // The first block's bottom, centred on the boundary, across the note column.
    expect(line!.style.top).toBe('39px');
    expect(line!.style.left).toBe('100px');
    expect(line!.style.width).toBe('400px');
    expect(line!.style.height).toBe('2px');
  });

  it('moves the line to the block the pointer has reached', () => {
    const harnessed = dragHarness();
    harnessed.answerFrom(3);
    dragOver(harnessed, harnessed.dom.children[0]);
    harnessed.answerFrom(harnessed.view.state.doc.child(0).nodeSize + 3);
    dragOver(harnessed, harnessed.dom.children[1]);

    expect(drawn()!.style.top).toBe('89px');
    // One element, repositioned: a drag is dozens of these.
    expect(document.querySelectorAll('.notes-drop-line')).toHaveLength(1);
  });

  it('draws nothing for a drag carrying no pictures', () => {
    const harnessed = dragHarness();
    harnessed.answerFrom(3);
    dragOver(harnessed, harnessed.dom.children[0], [{ kind: 'file', type: 'application/pdf' }]);
    expect(drawn()).toBeNull();
  });

  it('stands aside for an image block card, which takes the drop into itself', () => {
    const harnessed = dragHarness();
    const card = document.createElement('div');
    card.className = 'notes-image-card';
    harnessed.dom.children[1].appendChild(card);
    harnessed.answerFrom(3);

    dragOver(harnessed, card);

    expect(drawn()).toBeNull();
  });

  it('takes the line away when the pointer leaves the document', () => {
    const harnessed = dragHarness();
    harnessed.answerFrom(3);
    dragOver(harnessed, harnessed.dom.children[0]);
    expect(drawn()).not.toBeNull();

    const dragleave = harnessed.plugin.props.handleDOMEvents!.dragleave!;
    dragleave.call(harnessed.plugin, harnessed.view, {
      relatedTarget: document.body,
    } as unknown as DragEvent);

    expect(drawn()).toBeNull();
  });

  it('keeps the line while the pointer crosses from one block to the next', () => {
    const harnessed = dragHarness();
    harnessed.answerFrom(3);
    dragOver(harnessed, harnessed.dom.children[0]);

    const dragleave = harnessed.plugin.props.handleDOMEvents!.dragleave!;
    dragleave.call(harnessed.plugin, harnessed.view, {
      relatedTarget: harnessed.dom.children[1],
    } as unknown as DragEvent);

    expect(drawn()).not.toBeNull();
  });

  it('takes the line away on the drop it was pointing at', () => {
    const harnessed = dragHarness();
    harnessed.answerFrom(3);
    dragOver(harnessed, harnessed.dom.children[0]);

    harnessed.plugin.props.handleDrop!.call(
      harnessed.plugin,
      harnessed.view,
      { dataTransfer: { files: [] }, preventDefault: () => {}, clientX: 200, clientY: 60 } as unknown as DragEvent,
      null as never,
      false,
    );

    expect(drawn()).toBeNull();
  });
});
