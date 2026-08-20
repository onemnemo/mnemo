// @vitest-environment jsdom

/**
 * The cover picker's two entry points share this one component, so the races it can
 * lose are checked here rather than at either call site. Both of the cases below were
 * reproduced by hand first: an upload that outlived the choice it was replaced by, and
 * a rejection that outlived the popover that showed it.
 */

import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CoverPicker } from './NoteHeaderChrome';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Uploads are held open so a test decides when the bytes land, which is the only way to
// interleave a choice with an upload still in flight.
const uploads = vi.hoisted(() => {
  const waiting: ((dto: { assetId: string; displayName: string }) => void)[] = [];
  return {
    start: () =>
      new Promise<{ assetId: string; displayName: string }>((resolve) => {
        waiting.push(resolve);
      }),
    finish: (assetId: string) => waiting.shift()?.({ assetId, displayName: assetId }),
    clear: () => waiting.splice(0, waiting.length),
  };
});

vi.mock('../assets/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../assets/api')>()),
  uploadNoteAsset: () => uploads.start(),
}));

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  uploads.clear();
});

function mount(node: ReactNode): void {
  act(() => root.render(node));
}

/** The picker with a plain trigger, the shape the header affordance row uses. */
function picker(onChange: (next: string | null) => void, token: string | null = null): ReactNode {
  return (
    <CoverPicker token={token} onChange={onChange}>
      <button type="button" data-testid="trigger">
        cover
      </button>
    </CoverPicker>
  );
}

function click(target: Element | null): void {
  expect(target).not.toBeNull();
  act(() => {
    (target as HTMLElement).click();
  });
}

function openPicker(): void {
  click(container.querySelector("[data-testid='trigger']"));
}

function swatch(token: string): Element | null {
  return document.querySelector(`[aria-label='${token}']`);
}

/** A button in the open popover by its label, which is the i18n key on an empty bundle. */
function button(label: string): HTMLButtonElement | null {
  // Trimmed because a labelled button carries its icon's markup ahead of the words.
  const found = [...document.querySelectorAll('button')].find((el) => (el.textContent ?? '').trim() === label);
  return (found as HTMLButtonElement | undefined) ?? null;
}

/** The rejection line under the upload button, or null when none is showing. */
function problemText(): string | null {
  const message = document.querySelector('p.text-danger');
  return message ? (message.textContent ?? '') : null;
}

/** Picks a file the way the hidden input reports one, since jsdom has no file chooser. */
function choose(name: string, size = 1024): void {
  const input = document.querySelector("input[type='file']") as HTMLInputElement;
  expect(input).not.toBeNull();
  const file = new File([new Uint8Array(1)], name, { type: 'image/png' });
  Object.defineProperty(file, 'size', { value: size });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function settle(assetId: string): Promise<void> {
  await act(async () => {
    uploads.finish(assetId);
    await Promise.resolve();
  });
}

describe('CoverPicker uploads', () => {
  it('keeps a cover chosen while an upload was in flight', async () => {
    // The probe this reproduces: start a slow upload, click a swatch, and watch the
    // resolved upload overwrite the swatch seconds after the note already saved it.
    const onChange = vi.fn();
    mount(picker(onChange));
    openPicker();

    choose('big.png', 20 * 1024 * 1024);
    click(swatch('ocean'));
    await settle('new.png');

    expect(onChange.mock.calls.map(([next]) => next)).toEqual(['ocean']);
  });

  it('keeps a removal chosen while an upload was in flight', async () => {
    const onChange = vi.fn();
    mount(picker(onChange, 'sunset'));
    openPicker();

    choose('big.png', 20 * 1024 * 1024);
    click(button('RemoveCover'));
    await settle('new.png');

    expect(onChange.mock.calls.map(([next]) => next)).toEqual([null]);
  });

  it('applies an upload nothing superseded', async () => {
    const onChange = vi.fn();
    mount(picker(onChange));
    openPicker();

    choose('pic.png');
    await settle('new.png');

    expect(onChange.mock.calls.map(([next]) => next)).toEqual(['asset:new.png']);
  });

  it('leaves the picker usable after a superseded upload', async () => {
    // A guard, not a frozen picker: the spinner has to come off the upload button even
    // when the result it belonged to was thrown away.
    mount(picker(vi.fn()));
    openPicker();

    choose('big.png', 20 * 1024 * 1024);
    click(swatch('ocean'));
    await settle('new.png');

    openPicker();
    expect(button('UploadCover')?.disabled).toBe(false);
  });
});

describe('CoverPicker rejections', () => {
  it('clears a rejection when the popover is reopened', () => {
    mount(picker(vi.fn()));
    openPicker();

    choose('scan.tiff');
    expect(problemText()).toBe('CoverUploadUnsupported');

    openPicker();
    expect(problemText()).toBeNull();
    openPicker();
    expect(problemText()).toBeNull();
  });

  it('clears a rejection for the menu entry point, which controls open itself', () => {
    // PaneActions drives `open` from the outside, so a fix that only ran on the picker's
    // own toggle would leave that entry point showing the stale line.
    function Controlled() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" data-testid="raise" onClick={() => setOpen((was) => !was)}>
            raise
          </button>
          <CoverPicker token={null} onChange={vi.fn()} open={open} onOpenChange={setOpen}>
            <span data-testid="anchor" />
          </CoverPicker>
        </>
      );
    }
    mount(<Controlled />);

    click(container.querySelector("[data-testid='raise']"));
    choose('scan.tiff');
    expect(problemText()).toBe('CoverUploadUnsupported');

    click(container.querySelector("[data-testid='raise']"));
    click(container.querySelector("[data-testid='raise']"));
    expect(problemText()).toBeNull();
  });
});
