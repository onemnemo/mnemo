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
 * Missing is not the only way to be anonymous. A step whose replacement cannot
 * fit where it lands is fitted by splitting the node around it, and a split
 * clones the node it splits, attrs and all, so both halves come away sharing one
 * sid. Two blocks answering to the same name are permanently ambiguous to every
 * tool that addresses one, and the server refuses the whole commit over it, so
 * the second and later occurrence in document order is re-minted here too. The
 * first keeps the name it has already been quoted under.
 *
 * ## Cost
 *
 * Uniqueness is document-wide, so assigning one sid means knowing every sid.
 * That walk is gated behind a cheap check over the changed ranges only, so it
 * runs when a block is *created*, an Enter, a paste, and never on a keystroke
 * that merely edits text. A note built for tens of thousands of blocks cannot
 * afford the walk per character, and does not pay it. A repeat cannot be seen
 * from the changed ranges alone, so the gate for that half asks the cheaper
 * question of whether the change could have built a block at all.
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

import { Plugin, PluginKey, Selection } from 'prosemirror-state';
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

/**
 * Whether a changed range could have built a block node.
 *
 * A block is never inline content, so a step that adds one, or clones one by
 * splitting the node around a replacement that did not fit, always leaves a
 * changed range reaching outside a single line. A range that stays within one
 * line cannot have produced a block, let alone a second copy of one, and that is
 * what keeps the document-wide walk off the per-character path.
 */
function mayHaveBuiltBlocks(doc: PMNode, ranges: readonly DocRange[]): boolean {
  const limit = doc.content.size;
  for (const range of ranges) {
    const from = Math.min(Math.max(0, range.from), limit);
    const to = Math.min(Math.max(0, range.to), limit);
    if (to < from) return true;
    const $from = doc.resolve(from);
    if (!$from.parent.isTextblock || !$from.sameParent(doc.resolve(to))) return true;
  }
  return false;
}

/** Which of a block's two identifiers another block earlier in the document already carries. */
interface Repeat {
  readonly sid: boolean;
  readonly id: boolean;
}

/** Every sid spoken for, and where an identifier is spoken for twice. */
interface IdentityIndex {
  readonly taken: Set<string>;
  /** Keyed by document position, and holding only the second and later block. */
  readonly repeats: Map<number, Repeat>;
}

function identityIndex(doc: PMNode, registry: BlockRegistry): IdentityIndex {
  const taken = new Set<string>();
  const ids = new Set<string>();
  const repeats = new Map<number, Repeat>();
  // `descendants` walks in document order, so the block reached first is the one
  // that keeps the name.
  doc.descendants((node, pos) => {
    if (!registry.byNodeName.has(node.type.name)) return true;
    const sid: unknown = node.attrs.sid;
    const id: unknown = node.attrs.id;
    const sidTaken = typeof sid === 'string' && sid !== '' && taken.has(sid);
    const idTaken = typeof id === 'string' && id !== '' && ids.has(id);
    if (typeof sid === 'string' && sid !== '') taken.add(sid);
    if (typeof id === 'string' && id !== '') ids.add(id);
    if (sidTaken || idTaken) repeats.set(pos, { sid: sidTaken, id: idTaken });
    return true;
  });
  return { taken, repeats };
}

/**
 * A copy of `node` with a fresh identity on every block within that lacks one or
 * repeats one, or the node itself when nothing inside needs minting. Recurses so
 * a container's nested blocks (a two-column's cells) are covered by the same
 * pass. `index.taken` grows as sids are minted, so two blocks minted in one walk
 * cannot collide. `pos` is the node's position in the document the index was
 * built from, which is the document being rewritten.
 */
function reidentify(
  node: PMNode,
  pos: number,
  registry: BlockRegistry,
  index: IdentityIndex,
  deps: BlockIdentityDeps,
): PMNode {
  // A text run carries no identity and rebuilding it would drop its characters.
  if (node.isText) return node;

  let childrenChanged = false;
  const rebuilt: PMNode[] = [];
  let childPos = pos + 1;
  node.content.forEach((child) => {
    const next = reidentify(child, childPos, registry, index, deps);
    childPos += child.nodeSize;
    if (next !== child) childrenChanged = true;
    rebuilt.push(next);
  });

  const isBlock = registry.byNodeName.has(node.type.name);
  const repeat = isBlock ? index.repeats.get(pos) : undefined;
  const needsSid = isBlock && (node.attrs.sid === '' || repeat?.sid === true);
  const needsId = isBlock && (node.attrs.id === '' || repeat?.id === true);
  if (!needsSid && !needsId && !childrenChanged) return node;

  let attrs = node.attrs;
  if (needsSid || needsId) {
    const sid = needsSid ? deps.mintBlockSid(index.taken) : String(node.attrs.sid);
    if (needsSid) index.taken.add(sid);
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

/**
 * Whether a top-level block spanning `[start, end)` holds a repeated identifier.
 *
 * A split leaves both halves inside the range it changed, but the block a paste
 * or an agent edit collided with can be anywhere, and repairing only the copy
 * that happens to sit in the changed range would leave the pair intact.
 */
function holdsRepeat(start: number, end: number, repeats: ReadonlyMap<number, Repeat>): boolean {
  for (const pos of repeats.keys()) {
    if (pos >= start && pos < end) return true;
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

      // The cheap gate: only a change that introduced an anonymous block, or
      // could have built a block at all, does any work, so a plain keystroke
      // never reaches the document-wide sid walk.
      const doc = newState.doc;
      const anonymous = hasAnonymousIn(doc, ranges, registry);
      if (!anonymous && !mayHaveBuiltBlocks(doc, ranges)) return null;

      const index = identityIndex(doc, registry);
      if (!anonymous && index.repeats.size === 0) return null;
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
        if (!touchesRanges(start, end, ranges) && !holdsRepeat(start, end, index.repeats)) {
          flush();
          continue;
        }
        const rebuilt = reidentify(child, start, registry, index, deps);
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
      if (!tr.docChanged) return null;

      // Only attrs changed, so every position still means what it meant - but a
      // `replaceWith` maps a selection inside a rewritten block to the end of
      // that block, which is the start of the next one. Put the selection back
      // verbatim, or a command that inserts a block and drops the caret into it
      // lands the caret one block further on.
      const selection = newState.selection;
      tr.setSelection(Selection.fromJSON(tr.doc, selection.toJSON()));

      // No self-tag guard: this cannot retrigger itself. Its own transaction
      // rewrites top-level nodes, so the pass runs once more over it, but by then
      // every block carries both identifiers and no name is spoken for twice,
      // which are the only two conditions it acts on.
      return tr;
    },
  });
}
