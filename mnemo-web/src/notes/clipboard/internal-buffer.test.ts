// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { Fragment, Slice } from 'prosemirror-model';

import { createEditorSchema } from '../editor/schema';
import { clearStashedSlice, readStashedSlice, stashSlice } from './internal-buffer';

const { schema } = createEditorSchema();

const sliceOf = (text: string): Slice =>
  new Slice(
    Fragment.fromArray([
      schema.nodes.paragraph.create({ sid: 's', id: 's' }, schema.nodes.line.create(null, schema.text(text))),
    ]),
    0,
    0,
  );

describe('internal clipboard buffer', () => {
  beforeEach(() => clearStashedSlice());

  it('returns the exact stashed slice for its nonce', () => {
    const slice = sliceOf('x');
    const nonce = stashSlice(slice, 'blocks');
    const read = readStashedSlice(nonce);
    expect(read?.slice).toBe(slice);
    expect(read?.mode).toBe('blocks');
  });

  it('is null for a mismatched or foreign nonce', () => {
    stashSlice(sliceOf('x'), 'blocks');
    expect(readStashedSlice('mnemo-not-mine')).toBeNull();
  });

  it('keeps only the most recent copy, so an older nonce reads null', () => {
    const first = stashSlice(sliceOf('a'), 'blocks');
    const second = stashSlice(sliceOf('b'), 'text');
    expect(readStashedSlice(first)).toBeNull();
    expect(readStashedSlice(second)?.mode).toBe('text');
  });

  it('mints a distinct nonce each time', () => {
    expect(stashSlice(sliceOf('a'), 'blocks')).not.toBe(stashSlice(sliceOf('b'), 'blocks'));
  });
});
