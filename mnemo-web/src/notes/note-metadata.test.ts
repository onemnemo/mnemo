import { describe, expect, it } from 'vitest';

import type { NoteSummaryDto } from '@/api/types';

import { metadataUpdateOf } from './note-metadata';

const note: NoteSummaryDto = {
  id: 'n1',
  sid: 'n1',
  ver: 3,
  title: 'A note',
  folderId: null,
  parentNoteId: null,
  order: 0,
  isFavorite: false,
  createdAt: '2025-01-01T00:00:00Z',
  modifiedAt: '2025-01-01T00:00:00Z',
  emoji: null,
  cover: 'asset:abcd.png',
  coverCrop: '{"x":0,"y":0,"w":1,"h":1,"aspect":1}',
  tags: [],
};

describe('metadataUpdateOf', () => {
  it('carries the current coverCrop through an unrelated patch', () => {
    const update = metadataUpdateOf(note, { title: 'Renamed' });
    expect(update.coverCrop).toBe(note.coverCrop);
  });

  it('writes a new coverCrop alongside a new cover token in one update', () => {
    const update = metadataUpdateOf(note, { cover: 'asset:new.png', coverCrop: '{"x":0.1,"y":0,"w":0.8,"h":1,"aspect":2}' });
    expect(update.cover).toBe('asset:new.png');
    expect(update.coverCrop).toBe('{"x":0.1,"y":0,"w":0.8,"h":1,"aspect":2}');
  });

  it('clears coverCrop when a patch sets it back to null, such as a preset or removal', () => {
    const update = metadataUpdateOf(note, { cover: 'sunset', coverCrop: null });
    expect(update.cover).toBe('sunset');
    expect(update.coverCrop).toBeNull();
  });

  it('sends coverCrop as null for a note stored before the field existed', () => {
    const legacy = { ...note, coverCrop: undefined as unknown as string | null };
    const update = metadataUpdateOf(legacy, { title: 'Still renamed' });
    expect(update.coverCrop).toBeNull();
  });
});
