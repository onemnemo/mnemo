/**
 * Whether a set of transactions only edited text inside single lines, the case
 * typing produces. Such an edit cannot add, remove, move or retype a block, so
 * anything derived from the block structure can be mapped instead of rebuilt.
 */

import type { Transaction } from 'prosemirror-state';
import { AddMarkStep, RemoveMarkStep, ReplaceStep, type Step } from 'prosemirror-transform';
import type { Node as PMNode } from 'prosemirror-model';

function staysInOneTextblock(step: Step, doc: PMNode): boolean {
  if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) return true;
  if (!(step instanceof ReplaceStep)) return false;
  const { from, to, slice } = step;
  if (slice.openStart !== 0 || slice.openEnd !== 0) return false;
  for (let i = 0; i < slice.content.childCount; i++) if (!slice.content.child(i).isInline) return false;
  const $from = doc.resolve(from);
  return $from.parent.isTextblock && to <= $from.end();
}

export function onlyEditsText(transactions: readonly Transaction[]): boolean {
  for (const tr of transactions) {
    for (let i = 0; i < tr.steps.length; i++) {
      if (!staysInOneTextblock(tr.steps[i], tr.docs[i])) return false;
    }
  }
  return true;
}
