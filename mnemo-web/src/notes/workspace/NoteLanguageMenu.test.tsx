// @vitest-environment jsdom

/**
 * The Language submenu against a stubbed client and a seeded status.
 *
 * Two things here are worth the setup. The write does not touch the cache, so
 * every row has to invalidate after it or the checker keeps running over the
 * note in the languages it was already using. And the rows stay open, so a
 * second tick has to compose on the first rather than on a status that has not
 * heard about it yet, which is what the gated writes below are for.
 *
 * The menu owns its open state here, the way the pane does, so a row that
 * should leave the menu standing can be told apart from one that closes it.
 */

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { Menu, MenuContent, MenuTrigger } from '@/components/ui/menu';

import { PROOFING_STATUS_KEY } from '../proofing/status';
import type {
  NoteProofing,
  NoteProofingChoice,
  ProofingLanguage,
  ProofingStatus,
} from '../proofing/types';
import { NoteLanguageMenu } from './NoteLanguageMenu';

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('@/i18n/useT', () => ({ useT: () => (_ns: string, key: string) => key }));
vi.mock('@/app/router', () => ({ navigate }));
// Nothing here should reach the host: the status is seeded and the write is stubbed.
vi.mock('@/api/client', () => ({
  apiFetch: () => Promise.reject(new Error('no requests from this test')),
  apiSend: () => Promise.reject(new Error('no requests from this test')),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOTE_ID = 'note-1';

function language(id: string, name: string, region: string, installed = true): ProofingLanguage {
  return {
    id,
    name,
    region,
    installed,
    bundled: installed,
    state: installed ? 'ready' : 'absent',
    license: { name: 'MIT', url: 'https://example.invalid' },
  };
}

const CATALOGUE = [
  language('en-US', 'English', 'United States'),
  language('es-ES', 'Spanish', 'Spain'),
  language('nb-NO', 'Norwegian', 'Norway', false),
];

function statusWith(note: NoteProofing, active: readonly string[] = ['en-US']): ProofingStatus {
  return { enabled: true, active, languages: CATALOGUE, personalWordCount: 0, note };
}

const DEFAULTS = statusWith({ mode: 'default', languages: [], effective: ['en-US'] });
const NOTHING_INSTALLED: ProofingStatus = {
  enabled: true,
  active: [],
  languages: [],
  personalWordCount: 0,
  note: { mode: 'default', languages: [], effective: [] },
};

/** What the host answers a write with, near enough for the menu to read back. */
function echo(choice: NoteProofingChoice): NoteProofing {
  if (choice.mode === 'custom') {
    const languages = choice.languages ?? [];
    return { mode: 'custom', languages, effective: languages };
  }
  if (choice.mode === 'off') return { mode: 'off', languages: [], effective: [] };
  return { mode: 'default', languages: [], effective: ['en-US'] };
}

let container: HTMLElement;
let root: Root;
let queryClient: QueryClient;
let setNoteLanguages: Mock<(noteId: string, choice: NoteProofingChoice) => Promise<NoteProofing>>;
let invalidations: unknown[];

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false, gcTime: Infinity } },
  });
  invalidations = [];
  // Recorded rather than run: what matters is that the write asks for the
  // refetch, and a real one would only chase a host this test does not have.
  vi.spyOn(queryClient, 'invalidateQueries').mockImplementation((filters) => {
    invalidations.push(filters);
    return Promise.resolve();
  });
  setNoteLanguages = vi
    .fn<(noteId: string, choice: NoteProofingChoice) => Promise<NoteProofing>>()
    .mockImplementation((_noteId, choice) => Promise.resolve(echo(choice)));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger />
      <MenuContent>
        <NoteLanguageMenu noteId={NOTE_ID} onManageIgnores={() => {}} client={{ setNoteLanguages }} />
      </MenuContent>
    </Menu>
  );
}

/** Renders the submenu inside an open menu and walks into it, as a pointer would. */
function open(status?: ProofingStatus): void {
  if (status) queryClient.setQueryData([...PROOFING_STATUS_KEY, NOTE_ID], status);
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    ),
  );
  act(() => {
    subTrigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}

function subTrigger(): HTMLElement {
  const trigger = document.querySelector<HTMLElement>("[role='menuitem'][aria-haspopup='menu']");
  expect(trigger, 'the submenu row is missing').not.toBeNull();
  return trigger!;
}

function rows(): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>("[role='menuitemcheckbox'], [role='menuitem']"),
  ];
}

/** A row's label and its second line, run together, without the layout's whitespace. */
function text(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function row(label: string): HTMLElement {
  const found = rows().find((element) => text(element).startsWith(label));
  expect(found, `no row labelled ${label}`).not.toBeUndefined();
  return found!;
}

/** Drains the write chain, which runs several promise hops deep. */
async function settle(): Promise<void> {
  for (let hop = 0; hop < 20; hop += 1) await Promise.resolve();
}

/** Clicks a row and lets the write settle, so the invalidation after it has run. */
async function choose(label: string): Promise<void> {
  const target = row(label);
  await act(async () => {
    target.click();
    await settle();
  });
}

/** Holds every write open, so what is sent while one is outstanding can be seen. */
function gateWrites(): Array<() => void> {
  const waiting: Array<() => void> = [];
  setNoteLanguages.mockImplementation(
    (_noteId, choice) =>
      new Promise<NoteProofing>((resolve) => waiting.push(() => resolve(echo(choice)))),
  );
  return waiting;
}

function bodyOf(call: number): NoteProofingChoice {
  return setNoteLanguages.mock.calls[call][1];
}

describe('the summary on the row', () => {
  it('names what the note is checked in', () => {
    open(
      statusWith({ mode: 'custom', languages: ['en-US', 'es-ES'], effective: ['en-US', 'es-ES'] }),
    );

    expect(text(subTrigger())).toBe('SpellingLanguageEnglish, Spanish');
  });

  it('says the note is not checked when nobody wants it checked', () => {
    open(statusWith({ mode: 'off', languages: [], effective: [] }));

    expect(text(subTrigger())).toBe('SpellingLanguageSpellingOff');
  });

  it('says none installed when there is nothing to check with', () => {
    open(NOTHING_INSTALLED);

    expect(text(subTrigger())).toBe('SpellingLanguageSpellingNoneInstalled');
  });

  it('says nothing at all before the status arrives', () => {
    open();

    expect(text(subTrigger())).toBe('SpellingLanguage');
  });
});

describe('the rows', () => {
  it('offers every installed language and nothing absent', () => {
    open(DEFAULTS);

    const labels = rows().map(text);
    expect(labels).toContain('English');
    expect(labels).toContain('Spanish');
    expect(labels).not.toContain('Norwegian');
  });

  it('ticks the global set while the note is on the defaults', () => {
    open(DEFAULTS);

    expect(row('English').getAttribute('aria-checked')).toBe('true');
    expect(row('Spanish').getAttribute('aria-checked')).toBe('false');
    expect(row('SpellingUseDefaults').getAttribute('aria-checked')).toBe('true');
    expect(row('SpellingSkipNote').getAttribute('aria-checked')).toBe('false');
  });

  it("ticks the note's own list once it has one", () => {
    open(statusWith({ mode: 'custom', languages: ['es-ES'], effective: ['es-ES'] }));

    expect(row('English').getAttribute('aria-checked')).toBe('false');
    expect(row('Spanish').getAttribute('aria-checked')).toBe('true');
    expect(row('SpellingUseDefaults').getAttribute('aria-checked')).toBe('false');
  });

  it('ticks nothing but the skip row on a note that is not checked', () => {
    open(statusWith({ mode: 'off', languages: [], effective: [] }));

    expect(row('English').getAttribute('aria-checked')).toBe('false');
    expect(row('SpellingSkipNote').getAttribute('aria-checked')).toBe('true');
  });

  it('spells the defaults out under the row that follows them', () => {
    open(statusWith({ mode: 'default', languages: [], effective: ['en-US'] }, ['en-US', 'es-ES']));

    expect(text(row('SpellingUseDefaults'))).toBe('SpellingUseDefaultsEnglish, Spanish');
  });

  it('says so when the defaults are empty', () => {
    open(NOTHING_INSTALLED);

    expect(text(row('SpellingUseDefaults'))).toBe('SpellingUseDefaultsSpellingNoLanguagesOn');
  });
});

describe('what the rows write', () => {
  it('copies the defaults before adding to them', async () => {
    open(DEFAULTS);

    await choose('Spanish');

    expect(setNoteLanguages).toHaveBeenCalledWith(NOTE_ID, {
      mode: 'custom',
      languages: ['en-US', 'es-ES'],
    });
  });

  it('writes off rather than an empty list when the last language goes', async () => {
    open(statusWith({ mode: 'custom', languages: ['es-ES'], effective: ['es-ES'] }));

    await choose('Spanish');

    expect(setNoteLanguages).toHaveBeenCalledWith(NOTE_ID, { mode: 'off' });
  });

  it('puts a note back on the defaults', async () => {
    open(statusWith({ mode: 'custom', languages: ['es-ES'], effective: ['es-ES'] }));

    await choose('SpellingUseDefaults');

    expect(setNoteLanguages).toHaveBeenCalledWith(NOTE_ID, { mode: 'default' });
  });

  it('turns checking off on a note that follows the defaults', async () => {
    open(DEFAULTS);

    await choose('SpellingSkipNote');

    expect(setNoteLanguages).toHaveBeenCalledWith(NOTE_ID, { mode: 'off' });
  });

  it('turns checking back on from the same row', async () => {
    open(statusWith({ mode: 'off', languages: [], effective: [] }));

    await choose('SpellingSkipNote');

    expect(setNoteLanguages).toHaveBeenCalledWith(NOTE_ID, { mode: 'default' });
  });

  it('invalidates the status after every write, so the checker rebuilds', async () => {
    open(DEFAULTS);
    invalidations.length = 0;

    await choose('Spanish');

    expect(setNoteLanguages).toHaveBeenCalledTimes(1);
    expect(invalidations).toContainEqual({ queryKey: PROOFING_STATUS_KEY });
  });

  it('leaves the note as it was when the write is refused, and goes back for the truth', async () => {
    open(DEFAULTS);
    invalidations.length = 0;
    setNoteLanguages.mockRejectedValueOnce(new Error('refused'));

    await choose('Spanish');

    expect(row('Spanish').getAttribute('aria-checked')).toBe('false');
    expect(row('English').getAttribute('aria-checked')).toBe('true');
    expect(invalidations).toContainEqual({ queryKey: PROOFING_STATUS_KEY });
  });
});

describe('two ticks before either has come back', () => {
  it('composes the second on the first rather than on the stale status', async () => {
    const waiting = gateWrites();
    open(DEFAULTS);

    await choose('Spanish');
    expect(bodyOf(0)).toEqual({ mode: 'custom', languages: ['en-US', 'es-ES'] });

    // Nothing has come back and nothing has refetched, so the status still says
    // this note follows the defaults. The second tick must not read it.
    await choose('English');
    await act(async () => {
      waiting[0]();
      await settle();
    });

    expect(setNoteLanguages).toHaveBeenCalledTimes(2);
    expect(bodyOf(1)).toEqual({ mode: 'custom', languages: ['es-ES'] });
    expect(bodyOf(1)).not.toEqual({ mode: 'off' });
  });

  it('sends them one after the other rather than side by side', async () => {
    const waiting = gateWrites();
    open(DEFAULTS);

    await choose('Spanish');
    expect(setNoteLanguages).toHaveBeenCalledTimes(1);

    await choose('English');
    expect(setNoteLanguages, 'the second write went out beside the first').toHaveBeenCalledTimes(1);

    await act(async () => {
      waiting[0]();
      await settle();
    });

    expect(setNoteLanguages).toHaveBeenCalledTimes(2);
  });

  it('keeps the menu standing across both', async () => {
    gateWrites();
    open(DEFAULTS);

    await choose('Spanish');

    expect(
      rows().some((element) => text(element) === 'English'),
      'the menu closed on a language tick',
    ).toBe(true);
  });
});

describe('staying open', () => {
  it('closes on the rows that are not a tick among several', async () => {
    open(DEFAULTS);

    await choose('SpellingUseDefaults');

    expect(rows()).toHaveLength(0);
  });
});

describe('the way out to the settings page', () => {
  it('opens the spelling page', async () => {
    open(DEFAULTS);

    await choose('SpellingSettings');

    expect(navigate).toHaveBeenCalledWith('settings', 'Proofing');
  });
});
