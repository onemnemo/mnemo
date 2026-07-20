/**
 * Minting new blocks.
 *
 * Every block that comes into existence after a note is loaded goes through
 * here — the seed block an empty note opens with, and everything the `add` op
 * inserts. Centralized because a block born without a `sid` is invisible to the
 * model, and one born with a *duplicate* sid is worse: it makes two blocks
 * permanently ambiguous to every tool that addresses them.
 */

import { defaultTextStyle, type Block, type BlockPayload, type BlockType, type InlineSpan } from './types';
import { blockSidLength, mintSid, type RandomSource } from './sid';

export interface NewBlockOptions {
  readonly type?: BlockType;
  readonly spans?: readonly InlineSpan[];
  readonly payload?: BlockPayload;
  readonly children?: readonly Block[] | null;
  readonly meta?: Record<string, unknown>;
  readonly order?: number;
  /** Injectable so tests can mint deterministically. */
  readonly random?: RandomSource;
}

/**
 * Creates a block with a fresh GUID and a sid unique against `taken`.
 *
 * `taken` is the caller's responsibility to keep current: minting several
 * blocks in one batch means adding each new sid to the set as it is issued, or
 * the second draw can legally repeat the first.
 */
export function createBlock(taken: ReadonlySet<string>, options: NewBlockOptions = {}): Block {
  return {
    id: crypto.randomUUID(),
    sid: mintSid(taken, blockSidLength, options.random),
    type: options.type ?? 'Text',
    // Mnemo guarantees at least one span per block; a block with none is a
    // shape the C# reader never produces and the mapper would have to repair.
    spans: options.spans ? [...options.spans] : [{ kind: 'text', text: '', style: { ...defaultTextStyle } }],
    payload: options.payload ?? { kind: 'empty' },
    meta: options.meta ?? {},
    // Inert passthrough. The writer reindexes by position on save, so this is
    // a placeholder rather than a claim about where the block belongs.
    order: options.order ?? 0,
    children: options.children ? [...options.children] : null,
  };
}

/**
 * The block an otherwise empty note is opened with.
 *
 * `Note.Blocks` is nullable and a newly created note leaves it null, so "no
 * blocks" is an ordinary state rather than corruption. The C# editor handles it
 * the same way — `BlockEditor` appends a default Text block when a note
 * deserializes to zero rows — and the schema requires `block+`, so an empty
 * document is not representable and quarantining one would mean a new note
 * opening as unreadable.
 */
export function seedBlock(random?: RandomSource): Block {
  return createBlock(new Set(), { random });
}
