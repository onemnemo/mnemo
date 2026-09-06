// @vitest-environment jsdom

/**
 * Which checker owns the underlines.
 *
 * Browser underlines have no correction surface after the native context menu
 * is suppressed, so Mnemo's proofing decorations are the only checker shown.
 */

import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useSpellcheck } from './useSpellcheck';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

function Probe({ language }: { language?: string }) {
  const { spellCheck, lang } = useSpellcheck(language);
  return <div data-testid="probe" data-spellcheck={String(spellCheck)} data-lang={lang} />;
}

function render(language?: string): void {
  act(() =>
    root.render(
      <StrictMode>
        <Probe language={language} />
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
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the editor container spellcheck attributes', () => {
  it('turns the browser checker off while proofing is marking', () => {
    render();
    expect(read().spellCheck).toBe('false');
  });

  it('reports the language the note is checked in', () => {
    render('nb-NO');
    expect(read().lang).toBe('nb-NO');
  });

  it('falls back to English before the host has answered', () => {
    render();
    expect(read().lang).toBe('en');
  });
});
