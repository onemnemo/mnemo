// @vitest-environment jsdom

/**
 * Which checker owns the underlines.
 *
 * Two spellcheckers on one paragraph underline the same word twice, from two
 * dictionaries that disagree, and only one of them answers to the settings
 * page. So the browser's stands down whenever Mnemo's is marking or the note is
 * meant to go unchecked.
 *
 * The case worth pinning is the master switch. There is one control for spell
 * check, and off means off: a reader who turns it off and still sees red
 * underlines has been told the switch does nothing.
 */

import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useSettingsStore } from '@/settings/store';

import { useSpellcheck } from './useSpellcheck';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

function Probe({ standDown, language }: { standDown: boolean; language?: string }) {
  const { spellCheck, lang } = useSpellcheck(standDown, language);
  return <div data-testid="probe" data-spellcheck={String(spellCheck)} data-lang={lang} />;
}

function render(standDown: boolean, language?: string): void {
  act(() =>
    root.render(
      <StrictMode>
        <Probe standDown={standDown} language={language} />
      </StrictMode>,
    ),
  );
}

function read(): { spellCheck: string | null; lang: string | null } {
  const probe = container.querySelector('[data-testid="probe"]');
  return { spellCheck: probe?.getAttribute('data-spellcheck') ?? null, lang: probe?.getAttribute('data-lang') ?? null };
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  useSettingsStore.setState({ values: {}, secrets: {}, loaded: true, failed: false });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useSettingsStore.setState({ values: {}, secrets: {}, loaded: false, failed: false });
});

describe('the editor container spellcheck attributes', () => {
  it('turns the browser checker off while proofing is marking', () => {
    render(true);
    expect(read().spellCheck).toBe('false');
  });

  it('lets the browser fill in where Mnemo is not marking', () => {
    render(false);
    expect(read().spellCheck).toBe('true');

    act(() => {
      useSettingsStore.setState({ values: { 'Editor.SpellCheck': false } });
    });
    expect(read().spellCheck).toBe('false');
  });

  // The whole point of one switch: with it off, no checker underlines anything,
  // not the fallback the reader never chose either.
  it('turns both checkers off with the master switch', () => {
    act(() => {
      useSettingsStore.setState({ values: { 'Proofing.Enabled': false, 'Editor.SpellCheck': true } });
    });
    render(false);
    expect(read().spellCheck).toBe('false');
  });

  it('reports the language the note is checked in', () => {
    render(true, 'nb-NO');
    expect(read().lang).toBe('nb-NO');
  });

  it('falls back to English before the host has answered', () => {
    render(false);
    expect(read().lang).toBe('en');
  });
});
