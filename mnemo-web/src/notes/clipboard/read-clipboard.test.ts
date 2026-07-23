// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { Fragment, Slice } from 'prosemirror-model';

import { createEditorSchema } from '../editor/schema';
import { clearStashedSlice, stashSlice } from './internal-buffer';
import { readInternalSlice } from './read-clipboard';
import { MNEMO_CLIPBOARD_MIME, MNEMO_NONCE_ATTR } from './write-clipboard';

const { schema } = createEditorSchema();

const para = (text: string) =>
  schema.nodes.paragraph.create({ sid: 's1', id: 's1' }, schema.nodes.line.create(null, schema.text(text)));

/** A stashed slice plus the clipboard payload that carries its nonce. */
function copied(): { nonce: string } {
  const slice = new Slice(Fragment.fromArray([para('one')]), 0, 0);
  return { nonce: stashSlice(slice, 'blocks') };
}

const htmlWithNonce = (nonce: string) => `<div ${MNEMO_NONCE_ATTR}="${nonce}"><p>one</p></div>`;

function clipboard(entries: Record<string, string>): DataTransfer {
  return { getData: (type: string) => entries[type] ?? '' } as unknown as DataTransfer;
}

describe('readInternalSlice', () => {
  afterEach(() => clearStashedSlice());

  it('recovers the stashed slice from the private MIME', () => {
    const { nonce } = copied();
    const result = readInternalSlice(clipboard({ [MNEMO_CLIPBOARD_MIME]: htmlWithNonce(nonce) }));
    expect(result?.mode).toBe('blocks');
    expect(result?.slice.content.child(0).textContent).toBe('one');
  });

  it('recovers from text/html when the private MIME was dropped', () => {
    const { nonce } = copied();
    const result = readInternalSlice(clipboard({ 'text/html': htmlWithNonce(nonce) }));
    expect(result?.slice.content.child(0).textContent).toBe('one');
  });

  it('prefers the private MIME over text/html', () => {
    const { nonce } = copied();
    // text/html carries a nonce with no stashed slice; the private MIME wins and hits.
    const result = readInternalSlice(
      clipboard({ [MNEMO_CLIPBOARD_MIME]: htmlWithNonce(nonce), 'text/html': htmlWithNonce('mnemo-other') }),
    );
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

  it('declines our nonce when the stashed slice is gone', () => {
    const { nonce } = copied();
    clearStashedSlice();
    expect(readInternalSlice(clipboard({ 'text/html': htmlWithNonce(nonce) }))).toBeNull();
  });
});
