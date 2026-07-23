// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { Fragment, Slice } from 'prosemirror-model';

import { createEditorSchema } from '../editor/schema';
import { clearStashedSlice, stashSlice } from './internal-buffer';
import { readInternalSlice } from './read-clipboard';
import { MNEMO_CLIPBOARD_MIME, MNEMO_MODE_ATTR, MNEMO_NONCE_ATTR } from './write-clipboard';

const { schema } = createEditorSchema();

const para = (text: string) =>
  schema.nodes.paragraph.create({ sid: 's1', id: 's1' }, schema.nodes.line.create(null, schema.text(text)));

/** A stashed slice plus the JSON payload a copy writes to the private MIME. */
function copied(): { nonce: string; payload: string } {
  const slice = new Slice(Fragment.fromArray([para('one')]), 0, 0);
  const nonce = stashSlice(slice, 'blocks');
  const payload = JSON.stringify({ v: 1, nonce, mode: 'blocks', slice: slice.toJSON() });
  return { nonce, payload };
}

const htmlWithNonce = (nonce: string) =>
  `<div ${MNEMO_NONCE_ATTR}="${nonce}" ${MNEMO_MODE_ATTR}="blocks"><p>one</p></div>`;

function clipboard(entries: Record<string, string>): DataTransfer {
  return { getData: (type: string) => entries[type] ?? '' } as unknown as DataTransfer;
}

describe('readInternalSlice', () => {
  afterEach(() => clearStashedSlice());

  it('recovers the stashed slice from the private MIME payload', () => {
    const { payload } = copied();
    const result = readInternalSlice(clipboard({ [MNEMO_CLIPBOARD_MIME]: payload }));
    expect(result?.mode).toBe('blocks');
    expect(result?.slice.content.child(0).textContent).toBe('one');
  });

  it('recovers via the HTML nonce when the private MIME was dropped', () => {
    const { nonce } = copied();
    const result = readInternalSlice(clipboard({ 'text/html': htmlWithNonce(nonce) }));
    expect(result?.slice.content.child(0).textContent).toBe('one');
  });

  it('declines a clipboard with no nonce', () => {
    copied();
    expect(readInternalSlice(clipboard({ 'text/html': '<p>plain</p>' }))).toBeNull();
  });

  it('declines an empty clipboard', () => {
    copied();
    expect(readInternalSlice(clipboard({}))).toBeNull();
  });

  it('declines a nonce whose stashed slice is gone', () => {
    const { nonce } = copied();
    clearStashedSlice();
    expect(readInternalSlice(clipboard({ 'text/html': htmlWithNonce(nonce) }))).toBeNull();
  });

  it('ignores a malformed private-MIME payload and still finds the HTML nonce', () => {
    const { nonce } = copied();
    const result = readInternalSlice(
      clipboard({ [MNEMO_CLIPBOARD_MIME]: 'not json', 'text/html': htmlWithNonce(nonce) }),
    );
    expect(result?.slice.content.child(0).textContent).toBe('one');
  });

  it('declines an over-large private-MIME payload before parsing it', () => {
    // A hostile page could set a huge private MIME; the length cap must reject it
    // ahead of JSON.parse rather than build an unbounded tree.
    const huge = `{"v":1,"nonce":"x","mode":"blocks","slice":{}}${' '.repeat(4_000_001)}`;
    expect(readInternalSlice(clipboard({ [MNEMO_CLIPBOARD_MIME]: huge }))).toBeNull();
  });
});
