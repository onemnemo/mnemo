// @vitest-environment jsdom

/**
 * Checks exit-save warnings and host reporting. Neither reporting failure may interrupt caller
 * cleanup.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useI18nStore } from '@/i18n/store';
import { useToastStore } from '@/stores/toast';
import type { SaveResult } from '../authority/authority';
import { completeShutdown, onShutdown, resetShutdownForTests } from '@/app/shutdown';
import {
  EXIT_REPORT_MARGIN_MS,
  EXIT_REPORT_WAIT_MS,
  EXIT_RETRY_WAIT_MS,
  flushForExit,
  lostSaveVerdict,
  reportLostSave,
} from './lost-exit';

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
        SaveLostIncompleteTitle: 'last of {0} lost',
        SaveLostIncompleteDescription: 'the end was not written',
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

  it('calls a clean saved write safe', () => {
    expect(lostSaveVerdict({ status: 'saved', ver: 9, stillDirty: false })).toBeNull();
  });

  it('calls a saved write that is still dirty incomplete, since an exit has no later flush', () => {
    expect(lostSaveVerdict({ status: 'saved', ver: 9, stillDirty: true })).toBe('incomplete');
  });
});

describe('an exit inside the host grace period', () => {
  afterEach(() => {
    vi.useRealTimers();
    resetShutdownForTests();
  });

  /** Runs one window close with a second write that never answers; returns when the host heard of it. */
  async function closeWithStalledRetry(holdLands: boolean): Promise<number> {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const start = Date.now();
    let reportedAt = -1;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.endsWith('/app/save-lost')) reportedAt = Date.now() - start;
        const refused = url.endsWith('/app/shutdown-hold') && !holdLands;
        return Promise.resolve(new Response(null, { status: refused ? 500 : 204 }));
      }),
    );
    const flush = vi
      .fn<() => Promise<SaveResult>>()
      .mockResolvedValueOnce({ status: 'saved', ver: 1, stillDirty: true })
      .mockReturnValueOnce(new Promise(() => undefined));
    onShutdown(async () => {
      await reportLostSave('note-1', await flushForExit(flush), 'shutdown');
    });

    const done = completeShutdown(3_000);
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    return reportedAt;
  }

  it('tells the host before its grace runs out when the hold did not land', async () => {
    const at = await closeWithStalledRetry(false);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThanOrEqual(3_000 - EXIT_REPORT_MARGIN_MS);
  });

  it('waits the whole retry when the hold stopped the host clock', async () => {
    expect(await closeWithStalledRetry(true)).toBe(EXIT_RETRY_WAIT_MS);
  });
});

describe('a host report that never answers', () => {
  afterEach(() => {
    vi.useRealTimers();
    resetShutdownForTests();
  });

  /** A fetch that hangs on the lost-save report and answers everything else. */
  function stallReport(): { readyAt: () => number } {
    const start = Date.now();
    let readyAt = -1;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.endsWith('/app/save-lost')) return new Promise(() => undefined);
        if (url.endsWith('/app/shutdown-ready')) readyAt = Date.now() - start;
        const refused = url.endsWith('/app/shutdown-hold');
        return Promise.resolve(new Response(null, { status: refused ? 500 : 204 }));
      }),
    );
    return { readyAt: () => readyAt };
  }

  it('shows the warning without waiting on the request, and stops waiting at the bound', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stallReport();
    let settled = false;

    const done = reportLostSave('note-1', { status: 'failed', error: null }, 'close').then(() => {
      settled = true;
    });

    expect(useToastStore.getState().toasts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(EXIT_REPORT_WAIT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(settled).toBe(true);
  });

  it('answers the host ready inside its grace period', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stalled = stallReport();
    const flush = vi
      .fn<() => Promise<SaveResult>>()
      .mockResolvedValueOnce({ status: 'saved', ver: 1, stillDirty: true })
      .mockReturnValueOnce(new Promise(() => undefined));
    onShutdown(async () => {
      await reportLostSave('note-2', await flushForExit(flush), 'shutdown');
    });

    const done = completeShutdown(3_000);
    await vi.advanceTimersByTimeAsync(20_000);
    await done;

    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(stalled.readyAt()).toBeGreaterThanOrEqual(0);
    expect(stalled.readyAt()).toBeLessThan(3_000);
  });
});

describe('the save an exit makes', () => {
  const saved = (stillDirty: boolean) => ({ status: 'saved' as const, ver: 1, stillDirty });

  it('flushes once when the first write carried everything', async () => {
    const flush = vi.fn(() => Promise.resolve(saved(false)));
    await expect(flushForExit(flush)).resolves.toEqual(saved(false));
    expect(flush).toHaveBeenCalledOnce();
  });

  it('flushes a second time for typing the first missed, and never a third', async () => {
    const flush = vi.fn(() => Promise.resolve(saved(true)));
    await expect(flushForExit(flush)).resolves.toEqual(saved(true));
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it('stops waiting for a second write that does not answer, keeping the first answer', async () => {
    const flush = vi
      .fn<() => Promise<SaveResult>>()
      .mockResolvedValueOnce(saved(true))
      .mockReturnValueOnce(new Promise(() => undefined));
    await expect(flushForExit(flush, () => 5)).resolves.toEqual(saved(true));
  });

  it('keeps the first answer when the second write throws', async () => {
    const flush = vi
      .fn<() => Promise<SaveResult>>()
      .mockResolvedValueOnce(saved(true))
      .mockRejectedValueOnce(new Error('destroyed'));
    await expect(flushForExit(flush)).resolves.toEqual(saved(true));
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

  it('names an incomplete write as such, to the user and to the host', async () => {
    const fetchMock = stubFetch();
    mocks.title.mockReturnValue('Field notes');

    await reportLostSave('note-1', { status: 'saved', ver: 4, stillDirty: true }, 'shutdown');

    expect(useToastStore.getState().toasts[0]).toMatchObject({
      title: 'last of Field notes lost',
      description: 'the end was not written',
    });
    expect(sentBody(fetchMock)).toEqual({ noteId: 'note-1', verdict: 'incomplete', trigger: 'shutdown' });
  });

  it('reports one result once, for a flush that joined a close already under way', async () => {
    const fetchMock = stubFetch();
    const result: SaveResult = { status: 'failed', error: null };

    await reportLostSave('note-1', result, 'close');
    await reportLostSave('note-1', result, 'shutdown');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(useToastStore.getState().toasts).toHaveLength(1);
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
