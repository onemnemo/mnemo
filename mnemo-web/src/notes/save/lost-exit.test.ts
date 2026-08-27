// @vitest-environment jsdom

/**
 * Checks exit-save warnings and host reporting. Neither reporting failure may interrupt caller
 * cleanup.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useI18nStore } from '@/i18n/store';
import { useToastStore } from '@/stores/toast';
import { lostSaveVerdict, reportLostSave } from './lost-exit';

const mocks = vi.hoisted(() => ({ title: vi.fn(() => undefined as string | undefined) }));

vi.mock('../api', () => ({ readCachedNoteTitle: mocks.title }));

function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** What the host was sent, parsed. */
function sentBody(fetchMock: ReturnType<typeof vi.fn>): unknown {
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return JSON.parse(init.body as string);
}

beforeEach(() => {
  mocks.title.mockReturnValue(undefined);
  useToastStore.setState({ toasts: [], history: [] });
  useI18nStore.setState({
    bundle: {
      Notes: {
        SaveLostTitle: 'lost {0}',
        SaveLostFailedDescription: 'could not write it',
        SaveLostConflictDescription: 'somebody else wrote it',
        Untitled: 'no title',
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useToastStore.setState({ toasts: [], history: [] });
  useI18nStore.setState({ bundle: {} });
});

describe('the verdict for a save result', () => {
  it('calls a failed write lost', () => {
    expect(lostSaveVerdict({ status: 'failed', error: new Error('offline') })).toBe('failed');
  });

  it('calls a conflict lost', () => {
    expect(lostSaveVerdict({ status: 'conflict', ver: 9 })).toBe('conflict');
  });

  it('calls a skipped flush safe, because nothing reaches it with anything to lose', () => {
    expect(lostSaveVerdict({ status: 'skipped' })).toBeNull();
  });

  it('calls a saved write safe, still dirty included', () => {
    expect(lostSaveVerdict({ status: 'saved', ver: 9, stillDirty: false })).toBeNull();
    // The caller retains the dirty document and is responsible for another flush.
    expect(lostSaveVerdict({ status: 'saved', ver: 9, stillDirty: true })).toBeNull();
  });
});

describe('reporting a note whose last write did not land', () => {
  it('names the note, holds the warning open, and tells the host once', async () => {
    const fetchMock = stubFetch();
    mocks.title.mockReturnValue('Field notes');

    await reportLostSave('note-1', { status: 'failed', error: new Error('offline') }, 'close');

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({
      type: 'warning',
      title: 'lost Field notes',
      description: 'could not write it',
      durationMs: 0,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/app/save-lost');
    // An identifier and two names, never the note's own text.
    expect(sentBody(fetchMock)).toEqual({ noteId: 'note-1', verdict: 'failed', trigger: 'close' });
  });

  it('falls back to the untitled name when the note has no title of its own', async () => {
    stubFetch();
    // Untitled notes have an empty title, not a missing title.
    mocks.title.mockReturnValue('');

    await reportLostSave('note-1', { status: 'conflict', ver: 4 }, 'close');

    expect(useToastStore.getState().toasts[0]).toMatchObject({
      title: 'lost no title',
      description: 'somebody else wrote it',
    });
  });

  it('says nothing at all when the write landed', async () => {
    const fetchMock = stubFetch();

    await reportLostSave('note-1', { status: 'saved', ver: 4, stillDirty: false }, 'close');
    await reportLostSave('note-1', { status: 'skipped' }, 'shutdown');

    expect(useToastStore.getState().toasts).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still warns when the host cannot be told, and does not reject', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('no host'))),
    );

    // A shutdown participant awaits this, so a rejection here would turn a lost
    // note into a failed exit step.
    await expect(reportLostSave('note-1', { status: 'failed', error: null }, 'shutdown')).resolves.toBeUndefined();
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('still tells the host when the toast store cannot mint an id', async () => {
    const fetchMock = stubFetch();
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('no secure context');
    });

    await expect(reportLostSave('note-1', { status: 'failed', error: null }, 'close')).resolves.toBeUndefined();
    // Reporting failure must not prevent asset-session cleanup.
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
