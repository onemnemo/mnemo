/**
 * The containment rule the schema cannot state.
 *
 * Every block's content is `line block*`, so a column cell is a perfectly legal
 * child of a paragraph and a table row of a heading. `doc.check()` passes over
 * one and the wire round trip keeps it, which is what makes this the quiet
 * failure. A range edit that ends inside a table or a two-column has its
 * container cut away by ProseMirror's generic replace, which knows only the
 * schema, so the survivors are re-parented into the block at the start of the
 * range instead of being dropped. What the user is left with is a cell or a run
 * of rows drawn outside their grid, which the block chrome cannot point at and
 * the block selection will not take, saved that way.
 *
 * Stating the rule as an invariant rather than as something each command
 * remembers is the argument the never-empty cell makes for itself: the pipeline
 * replays it against whatever a transaction changed, whichever command produced
 * it, and a command author is left writing the edit.
 */

import { Fragment, type Node as PMNode, type Schema } from 'prosemirror-model';
import type { InvariantContribution } from '../registry/types';
import { blockChildrenOf, lineOf } from './shared';

/** The only parents each structural node is ever legitimately inside. */
const structuralParents: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['columnGroup', new Set(['twoColumn'])],
  ['tableRow', new Set(['table'])],
  ['tableCell', new Set(['tableRow'])],
]);

function strandedIn(typeName: string, parentName: string): boolean {
  const allowed = structuralParents.get(typeName);
  return allowed !== undefined && !allowed.has(parentName);
}

/**
 * `children` with every stranded structural node replaced by what it held, to
 * whatever depth the strand goes, so one rewrite leaves nothing for a second
 * pass. Null when nothing under `parentName` was stranded.
 *
 * A container's line is scenery and goes with it. A cell's line is where the
 * user's text lives, so it comes back as a paragraph rather than leaving with a
 * wrapper the user never made.
 */
function unstranded(
  parentName: string,
  children: readonly PMNode[],
  schema: Schema,
): PMNode[] | null {
  let changed = false;
  const out: PMNode[] = [];
  for (const child of children) {
    if (strandedIn(child.type.name, parentName)) {
      changed = true;
      const line = lineOf(child);
      if (line && line.content.size > 0) out.push(schema.nodes.paragraph.create(null, line));
      // What it held lands in `parentName`, so that is what decides whether the
      // children are stranded in their turn: a row taken out of a heading leaves
      // its cells in the heading, not in a row.
      const kept = blockChildrenOf(child);
      out.push(...(unstranded(parentName, kept, schema) ?? kept));
      continue;
    }
    const inner = unstranded(child.type.name, blockChildrenOf(child), schema);
    if (!inner) {
      out.push(child);
      continue;
    }
    changed = true;
    const line = lineOf(child);
    out.push(child.copy(Fragment.fromArray(line ? [line, ...inner] : inner)));
  }
  return changed ? out : null;
}

/**
 * The rule for one structural node type, contributed by the module that declares
 * it so the pipeline's per-type skip still applies.
 *
 * The whole parent is rewritten rather than the one node the scan landed on: a
 * dissolved container leaves a run of them side by side, and the changed range
 * reaches only as far as the first.
 *
 * It runs ahead of the repairs that fill a container back in (the never-empty
 * cell, the rectangular table), because unwrapping is what can leave a cell with
 * nothing in it; those two read the document as this leaves it rather than as
 * the edit did, so one pass settles. Nothing here can produce a stranded node,
 * so it never feeds itself.
 */
export function containmentInvariant(nodeName: string): InvariantContribution {
  return {
    id: `containment.${nodeName}`,
    order: 8,
    apply(ctx) {
      const { tr } = ctx;
      const schema = ctx.state.schema;
      const { paragraph, line } = schema.nodes;
      if (!paragraph || !line) return null;

      let touched = false;
      for (const range of ctx.changedRanges) {
        const from = Math.max(0, range.from);
        const to = Math.min(ctx.state.doc.content.size, range.to);
        if (from > to) continue;
        ctx.state.doc.nodesBetween(from, to, (node, pos, parent) => {
          if (node.type.name !== nodeName) return true;
          if (!parent || !strandedIn(nodeName, parent.type.name)) return true;

          // Read the parent as it stands rather than as the edit left it: an
          // earlier rewrite in this pass may already have taken it, and with it
          // everything it held. The document is the one parent with no position
          // and no line of its own.
          const $node = ctx.state.doc.resolve(pos);
          const atDoc = $node.depth === 0;
          const at = atDoc ? 0 : tr.mapping.map($node.before($node.depth));
          const live = atDoc ? tr.doc : tr.doc.nodeAt(at);
          if (!live || live.type.name !== parent.type.name) return false;

          const kept = unstranded(live.type.name, blockChildrenOf(live), schema);
          if (!kept) return false;
          const ownLine = lineOf(live);
          const content = ownLine ? [ownLine, ...kept] : kept;
          if (!live.type.validContent(Fragment.fromArray(content))) {
            // Unwrapping took everything the parent held and its type says it
            // cannot stand empty, which is also true of the note as a whole.
            content.push(paragraph.create(null, line.create()));
            if (!live.type.validContent(Fragment.fromArray(content))) return false;
          }
          tr.replaceWith(
            atDoc ? 0 : at + 1,
            atDoc ? tr.doc.content.size : at + live.nodeSize - 1,
            content,
          );
          touched = true;
          return false;
        });
      }
      return touched ? tr : null;
    },
  };
}
