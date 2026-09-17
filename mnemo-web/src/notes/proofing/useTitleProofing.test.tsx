// @vitest-environment jsdom

/**
 * The title is the one line of prose on the page the editor's scheduler never sees. It is
 * asked about as a segment of its own, once per saved title, and only while the body is
 * being checked; the words flagged come back for the surface to name.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProofingClient } from './client';
import { PROOFING_IGNORES_KEY, PROOFING_PERSONAL_KEY } from './status';
import type { ProofingCheckRequest, ProofingCheckResponse, ProofingIssue } from './types';
import { TITLE_SEGMENT_ID, useTitleProofing } from './useTitleProofing';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOTE = 'note-1';

function issueOf(text: string): ProofingIssue {
  return { start: 0, end: text.length, text, kind: 'spelling', tone: 'error' };
}

function answering(issues: readonly ProofingIssue[]): ProofingCheckResponse {
  return { languages: ['en-US'], paragraphs: [{ id: TITLE_SEGMENT_ID, issues }] };
}

function stubClient(check: ProofingClient['check']): ProofingClient {
  const never = () => new Promise<never>(() => undefined);
  return {
    check,
    status: never,
    suggest: never,
    personal: never,
    addPersonalWord: never,
    removePersonalWord: never,
    noteIgnores: never,
    addNoteIgnore: never,
    removeNoteIgnore: never,
    noteLanguages: never,
    setNoteLanguages: never,
  };
}

let container: HTMLElement;
let root: Root;
let queryClient: QueryClient;

function Probe({
  title,
  active,
  languages,
  client,
}: {
  title: string;
  active: boolean;
  languages: readonly string[];
  client: ProofingClient;
}) {
  const issues = useTitleProofing({ noteId: NOTE, title, active, languages, client });
  return <div data-testid="probe" data-flagged={issues.map((issue) => issue.text).join(',')} />;
}

async function render(props: { title: string; active?: boolean; languages?: readonly string[]; client: ProofingClient }) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Probe title={props.title} active={props.active ?? true} languages={props.languages ?? ['en-US']} client={props.client} />
      </QueryClientProvider>,
    );
  });
}

function flagged(): string {
  return container.querySelector('[data-testid="probe"]')?.getAttribute('data-flagged') ?? '';
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('useTitleProofing', () => {
  it('asks about the saved title as one segment and names what came back', async () => {
    const check = vi.fn(async (_request: ProofingCheckRequest) => answering([issueOf('recieve')]));
    await render({ title: 'How to recieve mail', client: stubClient(check) });

    expect(check).toHaveBeenCalledTimes(1);
    const request = check.mock.calls[0][0];
    expect(request.noteId).toBe(NOTE);
    expect(request.languages).toEqual(['en-US']);
    expect(request.paragraphs).toEqual([{ id: TITLE_SEGMENT_ID, text: 'How to recieve mail' }]);
    expect(flagged()).toBe('recieve');
  });

  it('asks nothing while the body is not being checked, and clears what it had', async () => {
    const check = vi.fn(async (_request: ProofingCheckRequest) => answering([issueOf('recieve')]));
    const client = stubClient(check);
    await render({ title: 'How to recieve mail', client });
    expect(flagged()).toBe('recieve');

    await render({ title: 'How to recieve mail', active: false, client });

    expect(check).toHaveBeenCalledTimes(1);
    expect(flagged()).toBe('');
  });

  it('asks nothing about an empty title or with no language read', async () => {
    const check = vi.fn(async (_request: ProofingCheckRequest) => answering([]));
    const client = stubClient(check);
    await render({ title: '   ', client });
    await render({ title: 'Untitled', languages: [], client });

    expect(check).not.toHaveBeenCalled();
  });

  it('asks again when the title is saved under a new name', async () => {
    const check = vi.fn(async (request: ProofingCheckRequest) =>
      answering(request.paragraphs[0].text.includes('recieve') ? [issueOf('recieve')] : []),
    );
    const client = stubClient(check);
    await render({ title: 'How to recieve mail', client });
    expect(flagged()).toBe('recieve');

    await render({ title: 'How to receive mail', client });

    expect(check).toHaveBeenCalledTimes(2);
    expect(flagged()).toBe('');
  });

  it('leaves the title unmarked while the dictionary is still being read', async () => {
    const check = vi.fn(async (_request: ProofingCheckRequest) => {
      throw Object.assign(new Error('loading'), { status: 503 });
    });
    await render({ title: 'How to recieve mail', client: stubClient(check) });

    expect(flagged()).toBe('');
  });

  it('asks again when a word list moves', async () => {
    const check = vi.fn(async (_request: ProofingCheckRequest) => answering([issueOf('Mnemo')]));
    const client = stubClient(check);
    queryClient.setQueryData(PROOFING_PERSONAL_KEY, { words: [] });
    queryClient.setQueryData([...PROOFING_IGNORES_KEY, NOTE], { words: [] });
    await render({ title: 'Mnemo notes', client });
    expect(check).toHaveBeenCalledTimes(1);

    check.mockImplementation(async () => answering([]));
    await act(async () => {
      queryClient.setQueryData(PROOFING_PERSONAL_KEY, {
        words: [{ word: 'Mnemo', language: null, addedAt: '2026-01-01T00:00:00Z' }],
      });
      // The query notifies its observers on a timer, not on the write.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(check).toHaveBeenCalledTimes(2);
    expect(flagged()).toBe('');
  });
});
