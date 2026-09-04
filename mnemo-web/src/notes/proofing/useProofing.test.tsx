// @vitest-environment jsdom

/**
 * The two booleans the note surface reads off proofing, and the gap between
 * them.
 *
 * `active` is "our marks are live". `suppressed` is "nothing should be checking
 * this at all", which is a different claim and has to be, because the surface
 * hands both to the browser's own checker: a note the reader asked to leave
 * alone must not be answered by underlines from the profile dictionary.
 *
 * The state between the two is the one worth pinning. While a dictionary is
 * still being read, neither is true: ours has nothing to say yet, and the
 * browser's covers the gap.
 */

import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSettingsStore } from '@/settings/store';

import { proofingStatusOf, registry } from './fixtures';
import { PROOFING_STATUS_KEY } from './status';
import { useProofing } from './useProofing';
import type { ProofingStatus } from './types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOTE = 'note-1';

let container: HTMLElement;
let root: Root;

/**
 * The view is null on purpose: the two booleans are computed before anything is
 * wired to a document, so this asks about them without mounting an editor.
 */
function Probe() {
  const proofing = useProofing({ view: null, registry, noteId: NOTE });
  return (
    <div
      data-testid="probe"
      data-active={String(proofing.active)}
      data-suppressed={String(proofing.suppressed)}
    />
  );
}

function render(status?: ProofingStatus): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (status) client.setQueryData([...PROOFING_STATUS_KEY, NOTE], status);
  act(() =>
    root.render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>
      </StrictMode>,
    ),
  );
}

function read(): { active: string | null; suppressed: string | null } {
  const probe = container.querySelector('[data-testid="probe"]');
  return {
    active: probe?.getAttribute('data-active') ?? null,
    suppressed: probe?.getAttribute('data-suppressed') ?? null,
  };
}

beforeEach(() => {
  // Never settles, so an unseeded query stays unanswered rather than racing the
  // assertions with a failure the retry would then chase.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  useSettingsStore.setState({ values: {}, secrets: {}, loaded: true, failed: false });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useSettingsStore.setState({ values: {}, secrets: {}, loaded: false, failed: false });
  vi.unstubAllGlobals();
});

describe('what the note surface reads off proofing', () => {
  it('suppresses nothing before the status arrives', () => {
    // An unanswered note looks exactly like one with nothing switched on, and
    // guessing would leave the opening seconds of every note unchecked by
    // anything at all.
    render();
    expect(read()).toEqual({ active: 'false', suppressed: 'false' });
  });

  it('suppresses a note the reader asked not to check', () => {
    render(
      proofingStatusOf(['en-US'], {
        note: { mode: 'off', languages: [], effective: [] },
      }),
    );
    expect(read()).toEqual({ active: 'false', suppressed: 'true' });
  });

  it('suppresses a note with nothing switched on to check it with', () => {
    render(proofingStatusOf([]));
    expect(read()).toEqual({ active: 'false', suppressed: 'true' });
  });

  it('suppresses nothing while the only dictionary is still being read', () => {
    // es-ES is installed and loading, so the set is not empty and the note was
    // not opted out: ours cannot mark yet and the browser's has to cover it.
    render(proofingStatusOf(['es-ES']));
    expect(read()).toEqual({ active: 'false', suppressed: 'false' });
  });

  it('marks, and suppresses nothing, once a dictionary is read', () => {
    render(proofingStatusOf(['en-US']));
    expect(read()).toEqual({ active: 'true', suppressed: 'false' });
  });

  it('stops marking when the toggle goes off, without suppressing the browser', () => {
    useSettingsStore.setState({ values: { 'Proofing.Enabled': false } });
    render(proofingStatusOf(['en-US']));
    expect(read()).toEqual({ active: 'false', suppressed: 'false' });
  });
});
