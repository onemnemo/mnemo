/**
 * The block action menu, described once.
 *
 * The gutter grip and the editor's right-click menu are two Radix families that
 * cannot share components, so they share this: one list of verbs over the
 * builders in ./block-commands, rendered twice. Each entry carries what it will
 * dispatch and what to say afterwards, so neither surface reimplements a verb
 * and neither can grow one the other lacks.
 */

import type { EditorState, Transaction } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

import type { IconName } from '@/components/icon/icon-registry';
import type { TranslateFn } from '@/i18n/types';

import { sidsWithin } from '../../selection/block-selection';
import { getBlockSelection } from '../../selection/block-selection-plugin';
import { buildDeleteSelected } from '../../selection/delete-selected';
import type { BlockRegistry } from '../registry/build';
import {
  canTurnInto,
  deleteBlock,
  duplicateBlock,
  isCurrentType,
  locateBlock,
  moveBlockDown,
  moveBlockUp,
  turnInto,
  TURN_INTO_OPTIONS,
  type BlockLocation,
} from './block-commands';
import { isCalloutNode } from './callout-icon';
import { openCalloutIcon } from './callout-icon-request';

/** Block node names to their NotesEditor key, the same names the slash menu uses. */
const BLOCK_LABEL_KEYS: Record<string, string> = {
  paragraph: 'Text',
  quote: 'Quote',
  bulletItem: 'BulletList',
  numberedItem: 'NumberedList',
  checklistItem: 'Checklist',
  codeBlock: 'Code',
  divider: 'Divider',
  image: 'Image',
  equationBlock: 'Equation',
  twoColumn: 'TwoColumn',
  columnGroup: 'TwoColumn',
  page: 'Page',
  sketch: 'Sketch',
};

/** The block's type in words, for the drag ghost and the screen reader. */
export function blockLabel(node: PMNode, t: TranslateFn): string {
  const name = node.type.name;
  if (name === 'heading') {
    // The bundle names four heading levels; a deeper one reads as the last.
    const level = Math.min(Math.max(Number(node.attrs.level ?? 1), 1), 4);
    return t('NotesEditor', `Heading${String(level)}`);
  }
  return t('NotesEditor', BLOCK_LABEL_KEYS[name] ?? 'Block');
}

export interface BlockMenuVerb {
  readonly kind: 'verb';
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName;
  readonly danger?: boolean;
  /** Marks the block's current type in "Turn into". */
  readonly emphasis?: boolean;
  readonly disabled?: boolean;
  /** Spoken once the verb runs, or null when another live region already speaks. */
  readonly announce: string | null;
  readonly build: (state: EditorState, loc: BlockLocation) => Transaction | null;
}

/**
 * A row that raises a layer rather than dispatching a transaction. The menu is
 * gone by the time the layer opens, so the row cannot own it; naming the ask is
 * all an entry can do, and the surface hands it on.
 */
export interface BlockMenuRequest {
  readonly kind: 'request';
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName;
  readonly request: 'calloutIcon';
}

export type BlockMenuEntry =
  | BlockMenuVerb
  | BlockMenuRequest
  | {
      readonly kind: 'submenu';
      readonly id: string;
      readonly label: string;
      readonly icon?: IconName;
      readonly items: readonly BlockMenuVerb[];
    }
  | { readonly kind: 'separator'; readonly id: string };

/**
 * The verbs offered on one block.
 *
 * When the block is part of a live multi-block selection, Delete takes the whole
 * selection and says so in its own label, so the menu never removes more than it
 * named. The other verbs stay per-block: moving or duplicating a run is not a
 * thing the document model does in one transaction.
 *
 * `location` may be null when the document moved under the menu's snapshot. The
 * list still builds (the sibling-dependent rows just read as unavailable) and
 * every verb re-locates its block at dispatch time.
 */
export function blockMenuItems({
  state,
  registry,
  node,
  location,
  t,
}: {
  state: EditorState;
  registry: BlockRegistry;
  node: PMNode;
  location: BlockLocation | null;
  t: TranslateFn;
}): readonly BlockMenuEntry[] {
  const ne = (key: string, params?: Record<string, string | number>) => t('NotesEditor', key, params);

  const selected = getBlockSelection(state).selected;
  const leaves = location ? sidsWithin(state.doc, registry, location.pos, location.node) : [];
  const inSelection = selected.size > 0 && leaves.some((sid) => selected.has(sid));

  const entries: BlockMenuEntry[] = [];

  entries.push(
    {
      kind: 'verb',
      id: 'move-up',
      label: t('Notes', 'MoveUp'),
      icon: 'common/arrow-up',
      disabled: !location?.prev,
      announce: ne('BlockMovedUp'),
      build: (s, loc) => moveBlockUp(s, loc),
    },
    {
      kind: 'verb',
      id: 'move-down',
      label: t('Notes', 'MoveDown'),
      icon: 'common/arrow-down',
      disabled: !location?.next,
      announce: ne('BlockMovedDown'),
      build: (s, loc) => moveBlockDown(s, loc),
    },
    {
      kind: 'verb',
      id: 'duplicate',
      label: t('Notes', 'Duplicate'),
      icon: 'common/copy',
      announce: ne('BlockDuplicated'),
      build: (s, loc) => duplicateBlock(s, loc),
    },
  );

  // The glyph itself is the pointer affordance; this is the same verb for a
  // reader who is not holding a pointer, and the only way back to a glyph on a
  // callout that has none.
  if (isCalloutNode(node)) {
    entries.push({
      kind: 'request',
      id: 'callout-icon',
      label: ne('CalloutIcon'),
      icon: 'notes/emoji',
      request: 'calloutIcon',
    });
  }

  if (canTurnInto(node)) {
    entries.push({
      kind: 'submenu',
      id: 'turn-into',
      label: ne('TurnInto'),
      icon: 'common/file-text',
      items: TURN_INTO_OPTIONS.map((option) => {
        const label = ne(option.labelKey);
        return {
          kind: 'verb' as const,
          id: `turn-into.${option.id}`,
          label,
          emphasis: isCurrentType(node, option),
          announce: ne('TurnedIntoFormat', { 0: label }),
          build: (s: EditorState, loc: BlockLocation) => turnInto(s, loc, option),
        };
      }),
    });
  }

  entries.push({ kind: 'separator', id: 'sep.delete' });

  entries.push(
    inSelection
      ? {
          kind: 'verb',
          id: 'delete',
          // The count rides on the label so the row names everything it takes,
          // rather than reading as a single-block delete next to a selection.
          label:
            selected.size > 1 ? ne('DeleteBlocksFormat', { 0: selected.size }) : t('Common', 'Delete'),
          icon: 'common/trash',
          danger: true,
          // The selection announcer speaks the clear that follows, so this stays
          // quiet rather than doubling the live region.
          announce: null,
          build: (s) => buildDeleteSelected(s, registry, selected),
        }
      : {
          kind: 'verb',
          id: 'delete',
          label: t('Common', 'Delete'),
          icon: 'common/trash',
          danger: true,
          // The document may never be emptied, so the last top-level block keeps
          // its Delete row visible but unavailable.
          disabled: (location?.parentPos ?? 0) < 0 && state.doc.childCount <= 1 && selected.size === 0,
          announce: ne('BlockDeleted'),
          build: (s, loc) => deleteBlock(s, loc),
        },
  );

  return entries;
}

/**
 * Dispatch a verb against the block it was built for, re-located first: the
 * snapshot's position may predate an earlier command or an invariant repair.
 * Returns whether anything was dispatched, so the caller knows to announce.
 */
export function runBlockVerb(
  view: EditorView,
  registry: BlockRegistry,
  target: { pos: number; sid: string },
  verb: BlockMenuVerb,
): boolean {
  const loc = locateBlock(view.state, registry, target.pos, target.sid);
  if (!loc) return false;
  const tr = verb.build(view.state, loc);
  if (!tr) return false;
  view.dispatch(tr);
  view.focus();
  return true;
}

/**
 * Raise what a request row names, on the block it was built for.
 *
 * Nothing is re-located here and nothing is dispatched: the layer that opens
 * resolves the block itself, and it opens after this returns, once the menu that
 * held the row has finished closing.
 */
export function runBlockRequest(target: { pos: number; sid: string }, entry: BlockMenuRequest): void {
  switch (entry.request) {
    case 'calloutIcon':
      openCalloutIcon(target);
      return;
  }
}
