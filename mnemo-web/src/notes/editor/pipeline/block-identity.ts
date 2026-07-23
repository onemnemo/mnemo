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
 *
 * Creating *many* blocks at once, a paste or an import, is the other size trap.
 * Re-identifying each block with its own `setNodeMarkup` is one document step per
 * block, and a step over a top-level node rebuilds the whole sibling array, so a
 * run of `n` blocks would cost O(n^2), seconds for a few thousand. Instead the
 * changed top-level blocks are re-identified in place (recursively, so a pasted
 * two-column's cells are covered) and a contiguous run is written back as one
 * `replaceWith`. A whole pasted run is then a single O(n) step. The rewrite
 * preserves node sizes, only attrs change, so earlier writes never move the
 * positions of later ones and the groups apply front to back untouched.
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { Fragment, type Node as PMNode } from 'prosemirror-model';
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

/** Whether any block inside the changed ranges is missing either identifier. */
function hasAnonymousIn(
  doc: PMNode,
  ranges: readonly DocRange[],
  registry: BlockRegistry,
): boolean {
  for (const range of ranges) {
    const from = Math.max(0, range.from);
    const to = Math.min(doc.content.size, range.to);
    if (from > to) continue;
    let found = false;
    doc.nodesBetween(from, to, (node) => {
      if (found) return false;
      if (!registry.byNodeName.has(node.type.name)) return true;
      if (node.attrs.sid === '' || node.attrs.id === '') found = true;
      return !found;
    });
    if (found) return true;
  }
  return false;
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

/**
 * A copy of `node` with a fresh identity on every block within that lacks one,
 * or the node itself when nothing inside needs minting. Recurses so a container's
 * nested blocks (a two-column's cells) are covered by the same pass. `taken`
 * grows as sids are minted, so two blocks minted in one walk cannot collide.
 */
function reidentify(
  node: PMNode,
  registry: BlockRegistry,
  taken: Set<string>,
  deps: BlockIdentityDeps,
): PMNode {
  // A text run carries no identity and rebuilding it would drop its characters.
  if (node.isText) return node;

  let childrenChanged = false;
  const rebuilt: PMNode[] = [];
  node.content.forEach((child) => {
    const next = reidentify(child, registry, taken, deps);
    if (next !== child) childrenChanged = true;
    rebuilt.push(next);
  });

  const isBlock = registry.byNodeName.has(node.type.name);
  const needsSid = isBlock && node.attrs.sid === '';
  const needsId = isBlock && node.attrs.id === '';
  if (!needsSid && !needsId && !childrenChanged) return node;

  let attrs = node.attrs;
  if (needsSid || needsId) {
    const sid = needsSid ? deps.mintBlockSid(taken) : String(node.attrs.sid);
    if (needsSid) taken.add(sid);
    const id = needsId ? deps.newBlockId() : String(node.attrs.id);
    attrs = { ...node.attrs, sid, id };
  }
  const content = childrenChanged ? Fragment.fromArray(rebuilt) : node.content;
  return node.type.create(attrs, content, node.marks);
}

/** Whether a top-level block spanning `[start, end)` touches any changed range. */
function touchesRanges(start: number, end: number, ranges: readonly DocRange[]): boolean {
  for (const range of ranges) {
    if (end >= range.from && start <= range.to) return true;
  }
  return false;
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

      // The cheap gate: only a change that introduced an anonymous block does any
      // work, so a plain keystroke never reaches the document-wide sid walk.
      const doc = newState.doc;
      if (!hasAnonymousIn(doc, ranges, registry)) return null;

      const taken = takenSids(doc, registry);
      const tr = newState.tr;

      // Re-identify the changed top-level blocks and write each contiguous run
      // back as one step. Sizes are unchanged, so positions from the original doc
      // stay valid across the writes and the groups apply front to back.
      let offset = 0;
      let group: { from: number; to: number; nodes: PMNode[] } | null = null;
      const flush = () => {
        if (group) tr.replaceWith(group.from, group.to, group.nodes);
        group = null;
      };
      for (let i = 0; i < doc.childCount; i++) {
        const child = doc.child(i);
        const start = offset;
        const end = offset + child.nodeSize;
        offset = end;
        if (!touchesRanges(start, end, ranges)) {
          flush();
          continue;
        }
        const rebuilt = reidentify(child, registry, taken, deps);
        if (rebuilt === child) {
          flush();
          continue;
        }
        if (group && group.to === start) {
          group.to = end;
          group.nodes.push(rebuilt);
        } else {
          flush();
          group = { from: start, to: end, nodes: [rebuilt] };
        }
      }
      flush();

      // No self-tag guard: this cannot retrigger itself, because the transaction
      // it appends leaves every block it touched with both identifiers set, and
      // that is the only condition it reacts to.
      return tr.docChanged ? tr : null;
    },
  });
}
