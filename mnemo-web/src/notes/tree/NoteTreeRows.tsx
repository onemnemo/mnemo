import type { ReactNode } from 'react';

import { FolderRow, NoteRow } from './NoteTreeRow';
import { treeKeyOf, type NoteFolderRowModel, type TreeRow } from './tree-model';
import type { TreeDrag } from './useNoteTreeDrag';

/**
 * The flat pre-order rows drawn as a tree. Deeper rows are wrapped in a `group` under
 * their parent so a screen reader hears the levels. The wrappers add no box.
 */
export function NoteTreeRows({
  rows,
  selectedNoteId,
  drag,
  onToggleFolder,
  onToggleNote,
  onExport,
}: {
  rows: readonly TreeRow[];
  selectedNoteId?: string;
  drag: TreeDrag;
  onToggleFolder: (id: string) => void;
  onToggleNote: (id: string) => void;
  onExport: (row: NoteFolderRowModel) => void;
}) {
  const level = (start: number, end: number): ReactNode[] => {
    const out: ReactNode[] = [];
    let i = start;
    while (i < end) {
      const row = rows[i];
      let next = i + 1;
      while (next < end && rows[next].depth > row.depth) next++;
      out.push(
        row.kind === 'folder' ? (
          <FolderRow key={treeKeyOf(row)} row={row} onToggle={onToggleFolder} onExport={onExport} drag={drag} />
        ) : (
          <NoteRow
            key={treeKeyOf(row)}
            row={row}
            selected={row.id === selectedNoteId}
            drag={drag}
            onToggle={onToggleNote}
          />
        ),
      );
      if (next > i + 1) {
        out.push(
          <div key={`group:${treeKeyOf(row)}`} role="group">
            {level(i + 1, next)}
          </div>,
        );
      }
      i = next;
    }
    return out;
  };

  return <>{level(0, rows.length)}</>;
}
