import { useCallback } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';

import { usePointerDrag, DRAG_START_THRESHOLD, COMMIT_DISTANCE } from '@/lib/dnd/usePointerDrag';
import type { Point } from '@/lib/dnd/usePointerDrag';
import type { NoteFolderDto } from '@/api/types';

import {
  resolveTreeDrop,
  type Box,
  type MeasuredRow,
  type TreeDragHandle,
  type TreeDropTarget,
} from './reorder';

/**
 * The notes tree's drag surface: what to measure (folder and note rows) and
 * where a drop may land (`resolveTreeDrop`). The pointer state machine, the two
 * thresholds, the ghost, Escape, edge auto-scroll and the swallowed trailing
 * click, is the shared `usePointerDrag`; only the geometry and legality live in
 * `reorder.ts`. Mirrors the flashcard library's drag so the note tree and the
 * deck tree behave identically under the hand.
 */

const GHOST_OFFSET_X = 20;
const GHOST_OFFSET_Y = 14;
const GHOST_TILT_DEG = -1.5;

export interface TreeDrag {
  sourceKey: string | null;
  handle: TreeDragHandle | null;
  target: TreeDropTarget | null;
  ghostRef: RefObject<HTMLDivElement | null>;
  placeGhost: () => void;
  press: (event: ReactPointerEvent, handle: TreeDragHandle) => void;
  suppressClick: (key: string) => boolean;
}

/** Row rectangles, read fresh on each move so a scroll under a held pointer stays honest. */
function measureRows(surface: HTMLElement): MeasuredRow[] {
  return Array.from(surface.querySelectorAll<HTMLElement>('[data-row-key]'), (element) => {
    const rect = element.getBoundingClientRect();
    return {
      key: element.dataset.rowKey ?? '',
      kind: element.dataset.rowKind === 'folder' ? 'folder' : 'note',
      id: element.dataset.rowId ?? '',
      depth: Number(element.dataset.rowDepth ?? 0),
      folderId: element.dataset.rowFolder || null,
      box: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    } satisfies MeasuredRow;
  });
}

function sameBox(a: Box | undefined, b: Box | undefined): boolean {
  if (!a || !b) return a === b;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

function sameTarget(a: TreeDropTarget | null, b: TreeDropTarget | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.mode === b.mode &&
    a.parentId === b.parentId &&
    a.refId === b.refId &&
    sameBox(a.line, b.line) &&
    sameBox(a.highlight, b.highlight)
  );
}

export function useNoteTreeDrag<TPlan>({
  surfaceRef,
  scrollRef,
  folders,
  plan,
  onDrop,
}: {
  surfaceRef: RefObject<HTMLElement | null>;
  scrollRef: RefObject<HTMLElement | null>;
  folders: readonly NoteFolderDto[];
  plan: (handle: TreeDragHandle, target: TreeDropTarget) => TPlan | null;
  onDrop: (planned: TPlan) => void;
}): TreeDrag {
  // Read fresh on every move: a refetch can replace the folder list mid-drag and
  // the legality rules must see the current tree, not the one the press closed over.
  const resolve = useCallback(
    (pointer: Point, source: TreeDragHandle): TreeDropTarget | null => {
      const surface = surfaceRef.current;
      if (!surface) return null;
      const rect = surface.getBoundingClientRect();
      return resolveTreeDrop({
        pointer,
        rows: measureRows(surface),
        surface: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        source,
        folders,
      });
    },
    [surfaceRef, folders],
  );

  const drag = usePointerDrag<TreeDragHandle, TreeDropTarget, TPlan>({
    getKey: (handle) => handle.key,
    ignorePressWithin: 'button, input',
    ghost: { offset: { x: GHOST_OFFSET_X, y: GHOST_OFFSET_Y }, tiltDeg: GHOST_TILT_DEG },
    startThreshold: DRAG_START_THRESHOLD,
    commitDistance: COMMIT_DISTANCE,
    autoScroll: { container: () => scrollRef.current },
    sameTarget,
    resolve,
    plan,
    onDrop,
  });

  return {
    sourceKey: drag.sourceKey,
    handle: drag.handle,
    target: drag.target,
    ghostRef: drag.ghostRef,
    placeGhost: drag.placeGhost,
    press: drag.press,
    suppressClick: drag.suppressClick,
  };
}
