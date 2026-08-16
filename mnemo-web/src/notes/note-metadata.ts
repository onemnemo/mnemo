import type { NoteSummaryDto, UpdateNoteMetadataDto } from '@/api/types';

/**
 * A note metadata update with one or more fields changed and the rest carried
 * through. The metadata endpoint is a full replace, not a patch, so sending back
 * only the field that changed would blank every other one; this keeps the whole
 * summary intact around the edit.
 */
export function metadataUpdateOf(
  note: NoteSummaryDto,
  patch: Partial<
    Pick<NoteSummaryDto, 'title' | 'folderId' | 'parentNoteId' | 'order' | 'isFavorite' | 'emoji' | 'cover' | 'tags'>
  >,
): UpdateNoteMetadataDto & { id: string } {
  const next = { ...note, ...patch };
  return {
    id: note.id,
    title: next.title,
    folderId: next.folderId,
    parentNoteId: next.parentNoteId,
    order: next.order,
    isFavorite: next.isFavorite,
    // A note stored before these fields existed has them undefined; send the
    // empty forms so the metadata replace is well formed either way.
    emoji: next.emoji ?? null,
    cover: next.cover ?? null,
    tags: next.tags ?? [],
  };
}
