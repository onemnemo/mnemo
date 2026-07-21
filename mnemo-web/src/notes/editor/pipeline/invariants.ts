/**
 * The invariant pipeline: one `appendTransaction` that keeps the document's
 * structural rules true after every edit.
 *
 * The desktop editor enforced its invariants ad hoc, at every mutation site that
 * could break one — heading-bold re-applied in a dozen setters, the two-column
 * never-empty rule reimplemented identically in six places. That is the shape
 * that rots: a new command is one more site that has to remember all of them. So
 * here the rules live once, as module contributions, and one pipeline replays
 * them against whatever a transaction changed, no matter which command produced
 * it. A command author writes the edit; the invariants clean up after it.
 *
 * Three properties make that safe rather than a source of loops:
 *
 *  - **Range-local.** Each invariant reads only what the transaction changed
 *    (`changedRanges`, in the *new* document's coordinates). Scanning the whole
 *    document per keystroke would miss the frame budget the moment a note is
 *    large, which is the size Notes is built for.
 *
 *  - **Ordered, single-pass.** Invariants run low `order` first, and structural
 *    ones (which move content) are ordered before cosmetic ones (which mark it),
 *    so one pass converges. The pipeline does not loop internally hoping for a
 *    fixpoint — it relies on the ordering being right, which is a property a test
 *    can pin rather than a runtime gamble.
 *
 *  - **Never reacts to itself.** The appended transaction is tagged, and a cycle
 *    triggered solely by that tag is a no-op. Without this an idempotent-looking
 *    invariant that always returns a transaction would spin ProseMirror's
 *    append loop forever.
 *
 *  - **Never reacts to an undo.** A repair rides in the same undo step as the
 *    edit that provoked it, so undoing that edit already takes the repair back
 *    with it. Running again on the way out would re-apply what was just removed
 *    and leave the user looking at a document their undo did not produce.
 */

import { Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { BlockRegistry } from '../registry/build';
import type { InvariantContext } from '../registry/types';
import { isHistoryRestore } from '../history';

/** A half-open document range, `to` exclusive, in a single coordinate space. */
export interface DocRange {
  readonly from: number;
  readonly to: number;
}

const pipelineKey = new PluginKey('notes-invariant-pipeline');

/**
 * The ranges `transactions` changed, expressed in the *final* document's
 * coordinate space so an invariant reading `newState.doc` lands in the right
 * place.
 *
 * A single transaction has several step maps and each map's output positions are
 * in the space *after* that step, not the final one — so each range is mapped
 * forward through every later map, in this transaction and in every transaction
 * after it. Skipping that would put the ranges in an intermediate space that
 * drifts further from the truth with every step, which is exactly the class of
 * off-by-a-block bug the shared coordinate space exists to prevent.
 */
export function changedRanges(transactions: readonly Transaction[]): DocRange[] {
  const ranges: DocRange[] = [];
  transactions.forEach((tr, ti) => {
    tr.mapping.maps.forEach((map, mi) => {
      map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
        let from = newStart;
        let to = newEnd;
        for (let i = mi + 1; i < tr.mapping.maps.length; i++) {
          from = tr.mapping.maps[i].map(from, -1);
          to = tr.mapping.maps[i].map(to, 1);
        }
        for (let j = ti + 1; j < transactions.length; j++) {
          from = transactions[j].mapping.map(from, -1);
          to = transactions[j].mapping.map(to, 1);
        }
        ranges.push({ from, to });
      });
    });
  });
  return mergeRanges(ranges);
}

/** Coalesces overlapping or touching ranges so an invariant visits each once. */
function mergeRanges(ranges: DocRange[]): DocRange[] {
  if (ranges.length < 2) return ranges;
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const out: DocRange[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const next = sorted[i];
    if (next.from <= last.to) {
      if (next.to > last.to) out[out.length - 1] = { from: last.from, to: next.to };
    } else {
      out.push({ ...next });
    }
  }
  return out;
}

/**
 * Whether any node of `nodeName` overlaps a changed range — the fast skip that
 * keeps an invariant from running when its block type was not touched at all.
 *
 * `nodesBetween` visits every node overlapping a range, ancestors included, so a
 * two-column container whose *child* changed still counts as touched. That is
 * required, not incidental: the never-empty rule reacts to a cell being emptied,
 * and the container node itself is what the rule rewrites.
 */
function touchesNodeType(doc: PMNode, ranges: readonly DocRange[], nodeName: string): boolean {
  for (const range of ranges) {
    const from = Math.max(0, range.from);
    const to = Math.min(doc.content.size, range.to);
    if (from > to) continue;
    let found = false;
    doc.nodesBetween(from, to, (node) => {
      if (found) return false;
      if (node.type.name === nodeName) {
        found = true;
        return false;
      }
      return true;
    });
    if (found) return true;
  }
  return false;
}

/**
 * The plugin. Built from the registry so it stays a pure function of the module
 * list — the invariants it runs are exactly the ones the modules contributed,
 * already sorted by `order` at registry assembly.
 */
export function invariantPipeline(registry: BlockRegistry): Plugin {
  const invariants = registry.invariants;

  return new Plugin({
    key: pipelineKey,
    appendTransaction(transactions, _oldState, newState) {
      if (invariants.length === 0) return null;
      if (!transactions.some((tr) => tr.docChanged)) return null;
      // A cycle caused only by our own appended transaction must terminate, or
      // ProseMirror's append loop never stops.
      if (transactions.every((tr) => tr.getMeta(pipelineKey) === true)) return null;
      // Undo restores a document that was already agreed; repairing it would
      // undo the undo.
      if (transactions.some(isHistoryRestore)) return null;

      const ranges = changedRanges(transactions);
      if (ranges.length === 0) return null;

      const tr = newState.tr;
      for (const invariant of invariants) {
        if (!touchesNodeType(newState.doc, ranges, invariant.nodeName)) continue;
        const ctx: InvariantContext = {
          state: newState,
          transactions,
          changedRanges: ranges,
          tr,
        };
        invariant.apply(ctx);
      }

      // The contract lets an invariant return null for "nothing to do", but the
      // authority on whether the pipeline contributed is whether steps were
      // actually added — an addMark over already-marked content is a no-op that
      // still hands back the transaction, and tagging an empty transaction would
      // burn an append cycle for nothing.
      if (!tr.docChanged) return null;
      tr.setMeta(pipelineKey, true);
      return tr;
    },
  });
}
