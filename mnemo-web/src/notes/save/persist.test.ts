// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';

import type { CommitNoteContentDto, NoteCommitResultDto } from '@/api/types';
import { createDocumentMapper } from '../editor/mapper/document';
import { createEditorSchema } from '../editor/schema';
import type { NoteSnapshot } from '../authority/authority';
import { defaultTextStyle, type Block } from '../model/types';
import { createPersist, requestIdOf, toCommitOutcome } from './persist';

const { schema, registry } = createEditorSchema();
const mapper = createDocumentMapper(schema, registry);

function blockOf(text: string, index: number): Block {
  return {
    id: `id-${String(index)}`,
    sid: `s${String(index).padStart(4, '0')}`,
    type: 'Text',
    spans: [{ kind: 'text', text, style: { ...defaultTextStyle } }],
    payload: { kind: 'empty' },
    meta: {},
    order: index,
    children: null,
  };
}

function docOf(texts: readonly string[]): PMNode {
  const result = mapper.toDoc(texts.map(blockOf));
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  return result.doc;
}

function snapshotOf(overrides: Partial<NoteSnapshot> = {}): NoteSnapshot {
  return {
    noteId: 'note-1',
    sid: 'n0001',
    doc: docOf(['hello']),
    ver: 7,
    rev: 3,
    saveState: 'dirty',
    dirty: true,
    ...overrides,
  };
}

/** A transport recording what it was sent, answering `Applied` at ver+1. */
function recordingTransport() {
  const sent: { noteId: string; body: CommitNoteContentDto }[] = [];
  const commit = vi.fn(
    (noteId: string, body: CommitNoteContentDto): Promise<NoteCommitResultDto> => {
      sent.push({ noteId, body });
      return Promise.resolve({ outcome: 'Applied', ver: body.baseVer + 1 });
    },
  );
  return { sent, commit };
}

describe('the commit body', () => {
  it('sends the version the document is based on, not a guess at the next one', async () => {
    const { sent, commit } = recordingTransport();
    await createPersist({ fromDoc: mapper.fromDoc, commit, sessionId: 'S' })(snapshotOf({ ver: 7 }));
    expect(sent[0].body.baseVer).toBe(7);
  });

  it('sends the note id from the snapshot', async () => {
    const { sent, commit } = recordingTransport();
    await createPersist({ fromDoc: mapper.fromDoc, commit, sessionId: 'S' })(snapshotOf());
    expect(sent[0].noteId).toBe('note-1');
  });

  it('serializes the live document, not the blocks it was loaded from', async () => {
    const { sent, commit } = recordingTransport();
    const snapshot = snapshotOf({ doc: docOf(['first', 'second']) });
    await createPersist({ fromDoc: mapper.fromDoc, commit, sessionId: 'S' })(snapshot);

    const blocks = sent[0].body.blocks as { spans: { text: string }[]; sid: string }[];
    expect(blocks).toHaveLength(2);
    expect(blocks.map((block) => block.spans[0].text)).toEqual(['first', 'second']);
    // The identity that crosses the AI boundary has to survive the round trip.
    expect(blocks.map((block) => block.sid)).toEqual(['s0000', 's0001']);
  });
});

describe('request ids', () => {
  it('is the same for one revision, so a retry reads as the same edit', () => {
    expect(requestIdOf('S', 4)).toBe(requestIdOf('S', 4));
  });

  it('differs across revisions, so a new edit is never mistaken for a replay', () => {
    expect(requestIdOf('S', 4)).not.toBe(requestIdOf('S', 5));
  });

  it('differs across sessions at the same revision', () => {
    // The failure this prevents: revisions restart at 0 on every open, so two
    // sessions would otherwise agree on an id for two unrelated first edits and
    // the server would answer AlreadyApplied to a write it had never seen.
    expect(requestIdOf('session-a', 1)).not.toBe(requestIdOf('session-b', 1));
  });

  it('mints a session of its own when none is supplied', async () => {
    const first = recordingTransport();
    const second = recordingTransport();
    await createPersist({ fromDoc: mapper.fromDoc, commit: first.commit })(snapshotOf({ rev: 1 }));
    await createPersist({ fromDoc: mapper.fromDoc, commit: second.commit })(snapshotOf({ rev: 1 }));
    expect(first.sent[0].body.requestId).not.toBe(second.sent[0].body.requestId);
  });

  it('holds one session across its own commits', async () => {
    const { sent, commit } = recordingTransport();
    const persist = createPersist({ fromDoc: mapper.fromDoc, commit });
    await persist(snapshotOf({ rev: 1 }));
    await persist(snapshotOf({ rev: 1 }));
    expect(sent[0].body.requestId).toBe(sent[1].body.requestId);
  });
});

describe('outcomes', () => {
  it('reads Applied as applied at the new version', () => {
    expect(toCommitOutcome({ outcome: 'Applied', ver: 8 })).toEqual({ status: 'applied', ver: 8 });
  });

  it('reads AlreadyApplied as applied, not as a conflict', () => {
    // A retry whose first response was lost did land. Calling it a conflict
    // would turn a dropped acknowledgement into something a person has to fix.
    expect(toCommitOutcome({ outcome: 'AlreadyApplied', ver: 8 })).toEqual({
      status: 'applied',
      ver: 8,
    });
  });

  it('reads Stale as a conflict carrying the version actually stored', () => {
    expect(toCommitOutcome({ outcome: 'Stale', ver: 12 })).toEqual({ status: 'conflict', ver: 12 });
  });

  it('reads NotFound as failure, since there is no version to rebase onto', () => {
    const outcome = toCommitOutcome({ outcome: 'NotFound', ver: 0 });
    expect(outcome.status).toBe('failed');
  });

  it('lets a transport rejection through for the authority to classify', async () => {
    const commit = vi.fn(() => Promise.reject(new Error('offline')));
    const persist = createPersist({ fromDoc: mapper.fromDoc, commit, sessionId: 'S' });
    await expect(persist(snapshotOf())).rejects.toThrow('offline');
  });
});
