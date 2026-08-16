import type { Crumb } from '@/nav/trail';
import type { NoteFolderDto, NoteSummaryDto } from '@/api/types';

import { buildBreadcrumb } from './breadcrumb-model';

/** The Notes nav glyph, so the root crumb reads the same as the rail entry. */
const NOTES_ICON = 'notebook-text';

/**
 * The note's place in the tree as crumbs for the shared topbar trail: the module
 * root, the folder path, the parent-page chain, then the note itself. Folders are
 * context rather than destinations, so they carry no link; an ancestor note links
 * to itself; the open note is the last crumb and never a link. The topbar's own
 * breadcrumb component handles overflow, so the whole chain is returned here.
 */
export function notesTrailCrumbs({
  noteId,
  notes,
  folders,
  rootLabel,
  untitled,
}: {
  noteId?: string;
  notes: readonly NoteSummaryDto[];
  folders: readonly NoteFolderDto[];
  rootLabel: string;
  untitled: string;
}): Crumb[] {
  const note = noteId ? notes.find((n) => n.id === noteId) : undefined;
  // No note open (or its summary has not loaded yet): the module name is the
  // whole trail, and it is where you already are, so it carries no link.
  if (!note) return [{ label: rootLabel, icon: NOTES_ICON }];

  const root: Crumb = { label: rootLabel, icon: NOTES_ICON, href: '#/notes' };
  const segments = buildBreadcrumb({ note, notes, folders, untitled });
  const rest = segments.map<Crumb>((seg, index) => {
    const last = index === segments.length - 1;
    if (seg.kind === 'note' && !last) return { label: seg.label, href: `#/notes/${seg.id}` };
    return { label: seg.label };
  });
  return [root, ...rest];
}
