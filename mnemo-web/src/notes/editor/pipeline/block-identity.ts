/**
 * Gives every block an identity the moment it exists.
 *
 * A block created by an edit, a split, an insert-above, a paste, an empty cell
 * an invariant filled in, is built from the schema's defaults, so its `id` and
 * `sid` are empty strings. The server mints a sid for every empty one it
 * receives, which sounds like enough and is not: a commit answers with a version
 * and nothing else, so the editor never learns what was chosen. The block would
 * be sent with an empty sid again on the *next* save and be assigned a
 * *different* one, over and over, until the note happened to be reloaded, and a
 * sid is the one identifier that crosses the AI boundary, quoted back in chat
 * history. An identifier that changes every few seconds is worse than none.
 *
 * So the editor mints its own, and the server's minting becomes the fallback it
 * should always have been. This is a separate plugin from the invariant pipeline
 * because it is a property of the *document* rather than of any block type: the
 * pipeline dispatches per node name, and identity belongs to all of them.
 *
 * ## Cost
 *
 * Uniqueness is document-wide, so assigning one sid means knowing every sid.
 * That walk is gated behind a cheap check over the changed ranges only, so it
 * runs when a block is *created*, an Enter, a paste, and never on a keystroke
 * that merely edits text. A note built for tens of thousands of blocks cannot
 * afford the walk per character, and does not pay it.
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { BlockRegistry } from '../registry/build';
import { changedRanges, type DocRange } from './invariants';
import { blockSidLength, mintSid } from '../../model/sid';

const identityKey = new PluginKey('notes-block-identity');

export interface BlockIdentityDeps {
  /** Mints a block sid not in `taken`. Injectable so tests are deterministic. */
  mintBlockSid(taken: ReadonlySet<string>): string;
  /** Mints a durable storage id. */
  newBlockId(): string;
}

const defaultDeps: BlockIdentityDeps = {
  mintBlockSid: (taken) => mintSid(taken, blockSidLength),
  newBlockId: () => crypto.randomUUID(),
};

interface Located {
  readonly pos: number;
  readonly node: PMNode;
}

/** Blocks inside the changed ranges that are missing either identifier. */
function anonymousBlocksIn(
  doc: PMNode,
  ranges: readonly DocRange[],
  registry: BlockRegistry,
): Located[] {
  const found = new Map<number, PMNode>();
  for (const range of ranges) {
    const from = Math.max(0, range.from);
    const to = Math.min(doc.content.size, range.to);
    if (from > to) continue;
    doc.nodesBetween(from, to, (node, pos) => {
      if (!registry.byNodeName.has(node.type.name)) return true;
      if (node.attrs.sid === '' || node.attrs.id === '') found.set(pos, node);
      return true;
    });
  }
  return [...found].map(([pos, node]) => ({ pos, node }));
}

/** Every sid already spoken for, anywhere in the document. */
function takenSids(doc: PMNode, registry: BlockRegistry): Set<string> {
  const taken = new Set<string>();
  doc.descendants((node) => {
    if (!registry.byNodeName.has(node.type.name)) return true;
    const sid: unknown = node.attrs.sid;
    if (typeof sid === 'string' && sid !== '') taken.add(sid);
    return true;
  });
  return taken;
}

export function blockIdentityPlugin(
  registry: BlockRegistry,
  deps: BlockIdentityDeps = defaultDeps,
): Plugin {
  return new Plugin({
    key: identityKey,
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;

      const ranges = changedRanges(transactions);
      if (ranges.length === 0) return null;

      const anonymous = anonymousBlocksIn(newState.doc, ranges, registry);
      if (anonymous.length === 0) return null;

      const taken = takenSids(newState.doc, registry);
      const tr = newState.tr;
      for (const { pos, node } of anonymous) {
        // Held even when it was already set, so two blocks created by one
        // transaction cannot be minted the same sid.
        const sid = node.attrs.sid === '' ? deps.mintBlockSid(taken) : String(node.attrs.sid);
        taken.add(sid);
        const id = node.attrs.id === '' ? deps.newBlockId() : String(node.attrs.id);
        // Positions are not mapped because they cannot move: `setNodeMarkup`
        // replaces a node with one of identical size.
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, sid, id });
      }

      // No self-tag guard: this cannot retrigger itself, because the transaction
      // it appends leaves every block it touched with both identifiers set, and
      // that is the only condition it reacts to.
      return tr.docChanged ? tr : null;
    },
  });
}
