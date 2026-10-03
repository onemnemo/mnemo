/**
 * Keeps exactly one start per numbered run, on its first item.
 *
 * Items are matched across an edit by block id, which the identity plugin has
 * given every block by now. An item counts as moved when the edit deleted it
 * where it stood, as a drag does. See `startFor` for how a run's start is picked.
 */

import { Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import { Mapping } from 'prosemirror-transform';
import type { Node as PMNode } from 'prosemirror-model';
import { storedListStart, withListStart } from '../blocks/list-start';
import { isHistoryRestore } from '../history';
import { forEachNumbered, listNumberKey } from './list-numbers';
import { onlyEditsText } from './text-only-steps';

const listStartKey = new PluginKey('notes-list-starts');

interface OldRun {
  /** The number the run showed first. */
  readonly start: number;
  /** Whether its first item stored that start. */
  readonly stored: boolean;
  readonly ids: string[];
  /** Where its first item stood. */
  readonly pos: number;
}

interface Was {
  readonly run: OldRun;
  readonly index: number;
  readonly pos: number;
}

interface Item {
  readonly node: PMNode;
  readonly pos: number;
  readonly id: string;
}

function idOf(node: PMNode): string {
  return String(node.attrs.id ?? '');
}

function oldRuns(doc: PMNode): { items: Map<string, Was>; runs: OldRun[] } {
  const items = new Map<string, Was>();
  const runs: OldRun[] = [];
  forEachNumbered(doc, (node, pos, index, number, _depth, id) => {
    if (index === 0) runs[id] = { start: number, stored: storedListStart(node.attrs.meta) !== null, ids: [], pos };
    const run = runs[id];
    const itemId = idOf(node);
    run.ids.push(itemId);
    if (itemId && !items.has(itemId)) items.set(itemId, { run, index, pos });
  });
  return { items, runs };
}

function newRuns(doc: PMNode): Item[][] {
  const runs: Item[][] = [];
  forEachNumbered(doc, (node, pos, index, _number, _depth, id) => {
    if (index === 0) runs[id] = [];
    runs[id].push({ node, pos, id: idOf(node) });
  });
  return runs;
}

interface Edit {
  readonly before: ReadonlyMap<string, Was>;
  /** Whether an item is still numbered where it stood. */
  readonly stayed: (was: Was) => boolean;
  readonly gone: (id: string) => boolean;
  /** The run whose first item the edit removed from this position. */
  readonly replacedAt: ReadonlyMap<number, OldRun>;
}

/**
 * The start `run` should open with: a number, null for none, or undefined to
 * leave its first item's own. In order:
 *
 *  - a first item that stayed keeps its start, so the earlier run wins a merge;
 *  - a block new to the document that brings a start keeps it (a paste);
 *  - the start of an old first item further down moves up, when it stayed or
 *    moved within its own run;
 *  - a first item whose old run lost every item above it from this run
 *    continues that run;
 *  - a new block put where a removed first item stood takes over its start;
 *  - a moved first item keeps its own, and anything else has none.
 */
function startFor(run: readonly Item[], edit: Edit): number | null | undefined {
  const first = run[0];
  const head = edit.before.get(first.id);
  if (head?.index === 0 && edit.stayed(head)) return undefined;
  if (!head && storedListStart(first.node.attrs.meta) !== null) return storedListStart(first.node.attrs.meta);

  for (let k = 1; k < run.length; k++) {
    const was = edit.before.get(run[k].id);
    if (was?.index === 0 && (edit.stayed(was) || head?.run === was.run)) {
      return storedListStart(run[k].node.attrs.meta);
    }
  }

  if (head && head.index > 0 && head.run.stored && edit.stayed(head)) {
    const inRun = new Set(run.map((item) => item.id));
    const left = (id: string): boolean => edit.gone(id) && !inRun.has(id);
    if (head.run.ids.slice(0, head.index).every(left)) return head.run.start + head.index;
  }

  if (!head) {
    const replaced = edit.replacedAt.get(first.pos);
    return replaced?.stored ? replaced.start : undefined;
  }
  return head.index === 0 ? undefined : null;
}

export function listStartPlugin(): Plugin {
  return new Plugin({
    key: listStartKey,
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged) || transactions.some(isHistoryRestore)) return null;
      if (onlyEditsText(transactions)) return null;
      const old = listNumberKey.getState(oldState);
      const now = listNumberKey.getState(newState);
      if (!old || !now || (!old.anyStart && !now.anyStart)) return null;

      const mapping = new Mapping();
      for (const tr of transactions) mapping.appendMapping(tr.mapping);
      const { items: before, runs: oldList } = oldRuns(oldState.doc);
      const runs = newRuns(newState.doc);
      const numberedNow = new Set<string>();
      for (const run of runs) for (const item of run) numberedNow.add(item.id);

      const stayed = (was: Was): boolean => !mapping.mapResult(was.pos, 1).deleted;
      const gone = (id: string): boolean => {
        const was = before.get(id);
        return !numberedNow.has(id) || (was !== undefined && !stayed(was));
      };
      const replacedAt = new Map<number, OldRun>();
      for (const run of oldList) {
        if (gone(run.ids[0])) replacedAt.set(mapping.map(run.pos, -1), run);
      }
      const edit: Edit = { before, stayed, gone, replacedAt };

      let tr: Transaction | null = null;
      const write = (item: Item, start: number | null): void => {
        const next = withListStart(item.node.attrs.meta, start);
        if (storedListStart(next) === storedListStart(item.node.attrs.meta)) return;
        tr ??= newState.tr;
        tr.setNodeAttribute(item.pos, 'meta', next);
      };
      for (const run of runs) {
        const start = startFor(run, edit);
        if (start !== undefined) write(run[0], start);
        for (let k = 1; k < run.length; k++) if (storedListStart(run[k].node.attrs.meta) !== null) write(run[k], null);
      }
      return tr;
    },
  });
}
