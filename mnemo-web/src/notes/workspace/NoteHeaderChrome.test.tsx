// @vitest-environment jsdom

/**
 * The cover picker's two entry points share this one component, so the races it can
 * lose are checked here rather than at either call site. The upload and reposition
 * flows both hand off to the shared image editor dialog, which this file stands in
 * for with a controllable promise: it never renders the real dialog, only resolves
 * what a confirmed (or cancelled) edit hands back.
 */

import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ImageCrop } from '@/components/ui/image-editor/geometry';
import { toast } from '@/stores/toast';

import { CoverPicker } from './NoteHeaderChrome';

vi.mock('@/stores/toast', () => ({
  toast: { warning: vi.fn() },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type EditorResult = { file: File | null; crop: ImageCrop } | null;

// Both async legs the picker hands off to (the editor dialog, then the network upload) are
// held open so a test decides when each lands, which is the only way to interleave a choice
// with either one still in flight.
const editor = vi.hoisted(() => {
  const waiting: ((result: EditorResult) => void)[] = [];
  const requests: unknown[] = [];
  return {
    open: (request: unknown) => {
      requests.push(request);
      return new Promise<EditorResult>((resolve) => {
        waiting.push(resolve);
      });
    },
    finish: (result: EditorResult) => waiting.shift()?.(result),
    lastRequest: () => requests[requests.length - 1],
    clear: () => {
      waiting.splice(0, waiting.length);
      requests.splice(0, requests.length);
    },
  };
});

vi.mock('@/components/ui/image-editor/store', () => ({
  editImage: (request: unknown) => editor.open(request),
}));

const uploads = vi.hoisted(() => {
  const waiting: {
    resolve: (dto: { assetId: string; displayName: string }) => void;
    reject: (error: unknown) => void;
  }[] = [];
  return {
    start: () =>
      new Promise<{ assetId: string; displayName: string }>((resolve, reject) => {
        waiting.push({ resolve, reject });
      }),
    finish: (assetId: string) => waiting.shift()?.resolve({ assetId, displayName: assetId }),
    fail: (error: unknown) => waiting.shift()?.reject(error),
    clear: () => waiting.splice(0, waiting.length),
  };
});

vi.mock('../assets/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../assets/api')>()),
  uploadNoteAsset: () => uploads.start(),
}));

vi.mock('@/api/asset-blob', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/asset-blob')>()),
  fetchAssetBlobUrl: () => Promise.resolve('blob:current-cover'),
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
  editor.clear();
  vi.mocked(toast.warning).mockClear();
});

function mount(node: ReactNode): void {
  act(() => root.render(node));
}

function fakeCrop(overrides: Partial<ImageCrop> = {}): ImageCrop {
  return { x: 0.1, y: 0.1, w: 0.5, h: 0.5, aspect: 1.5, ...overrides };
}

function fakeFile(name = 'pic.png', size = 1024): File {
  const file = new File([new Uint8Array(1)], name, { type: 'image/png' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

/** The picker with a plain trigger, the shape the header affordance row uses. */
function picker(
  onChange: (next: { cover: string | null; coverCrop: string | null }) => void,
  token: string | null = null,
  coverCrop: string | null = null,
  measureBandAspect: () => number = () => 3,
): ReactNode {
  return (
    <CoverPicker token={token} coverCrop={coverCrop} measureBandAspect={measureBandAspect} onChange={onChange}>
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

/** Settles the editor dialog's promise with a chosen result, flushing the microtask after it. */
async function confirmEditor(result: EditorResult): Promise<void> {
  await act(async () => {
    editor.finish(result);
    await Promise.resolve();
  });
}

/**
 * Flushes the microtask reposition spends fetching the current cover's bytes before it ever
 * calls the editor, so `editor.finish` below has a request waiting to settle.
 */
async function flushFetch(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function settleUpload(assetId: string): Promise<void> {
  await act(async () => {
    uploads.finish(assetId);
    await Promise.resolve();
  });
}

describe('CoverPicker upload', () => {
  it('uploads the confirmed picture and stores its crop with the new token, in one change', async () => {
    const onChange = vi.fn();
    mount(picker(onChange));
    openPicker();

    click(button('UploadCover'));
    await confirmEditor({ file: fakeFile(), crop: fakeCrop() });
    await settleUpload('new.png');

    expect(onChange.mock.calls).toEqual([[{ cover: 'asset:new.png', coverCrop: JSON.stringify(fakeCrop()) }]]);
  });

  it('stores no crop for a selection that keeps the whole picture', async () => {
    const onChange = vi.fn();
    mount(picker(onChange));
    openPicker();

    click(button('UploadCover'));
    await confirmEditor({ file: fakeFile(), crop: { x: 0, y: 0, w: 1, h: 1, aspect: 1 } });
    await settleUpload('new.png');

    expect(onChange.mock.calls).toEqual([[{ cover: 'asset:new.png', coverCrop: null }]]);
  });

  it('changes nothing when the editor is cancelled', async () => {
    const onChange = vi.fn();
    mount(picker(onChange));
    openPicker();

    click(button('UploadCover'));
    await confirmEditor(null);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('measures the band aspect fresh and hands it to the editor', () => {
    const measureBandAspect = vi.fn(() => 2.5);
    mount(picker(vi.fn(), null, null, measureBandAspect));
    openPicker();

    click(button('UploadCover'));

    expect(measureBandAspect).toHaveBeenCalledTimes(1);
    expect((editor.lastRequest() as { aspect: number }).aspect).toBe(2.5);
  });

  it('keeps a preset chosen while an upload was in flight', async () => {
    // The probe this reproduces: confirm a crop, let the network upload start, and watch a
    // stale result overwrite the swatch the note already saved seconds later.
    const onChange = vi.fn();
    mount(picker(onChange));
    openPicker();

    click(button('UploadCover'));
    await confirmEditor({ file: fakeFile('big.png', 20 * 1024 * 1024), crop: fakeCrop() });
    // The network upload is now in flight; the picker reopens for a different choice.
    openPicker();
    click(swatch('ocean'));
    await settleUpload('late.png');

    expect(onChange.mock.calls).toEqual([[{ cover: 'ocean', coverCrop: null }]]);
  });

  it('keeps a removal chosen while an upload was in flight', async () => {
    const onChange = vi.fn();
    mount(picker(onChange, 'sunset'));
    openPicker();

    click(button('UploadCover'));
    await confirmEditor({ file: fakeFile('big.png', 20 * 1024 * 1024), crop: fakeCrop() });
    openPicker();
    click(button('RemoveCover'));
    await settleUpload('late.png');

    expect(onChange.mock.calls).toEqual([[{ cover: null, coverCrop: null }]]);
  });

  it('leaves the picker usable after a superseded upload', async () => {
    // A guard, not a frozen picker: the spinner has to come off the upload button even
    // when the result it belonged to was thrown away.
    mount(picker(vi.fn()));
    openPicker();

    click(button('UploadCover'));
    await confirmEditor({ file: fakeFile('big.png', 20 * 1024 * 1024), crop: fakeCrop() });
    openPicker();
    click(swatch('ocean'));
    await settleUpload('late.png');

    openPicker();
    expect(button('UploadCover')?.disabled).toBe(false);
  });

  it('reports a failed upload with a toast the moment it fails, and clears the latch on the next opening', async () => {
    mount(picker(vi.fn()));
    openPicker();

    click(button('UploadCover'));
    await confirmEditor({ file: fakeFile(), crop: fakeCrop() });
    await act(async () => {
      uploads.fail(new Error('network'));
      await Promise.resolve();
    });

    // The popover is already closed at this point, so the toast is the only thing that
    // told the user anything happened at all.
    expect(toast.warning).toHaveBeenCalledWith('CoverUploadFailed');

    openPicker();
    expect(problemText()).toBe('CoverUploadFailed');

    openPicker();
    expect(problemText()).toBeNull();
  });

  it('shows a background failure with a toast and clears the latch once closed, for the menu entry point too', async () => {
    // PaneActions drives `open` from the outside, so a fix that only ran on the picker's
    // own toggle would leave that entry point showing the stale line, or clear it the
    // moment it reopens to show the very failure it is meant to reveal.
    function Controlled() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" data-testid="raise" onClick={() => setOpen((was) => !was)}>
            raise
          </button>
          <CoverPicker token={null} coverCrop={null} measureBandAspect={() => 3} onChange={vi.fn()} open={open} onOpenChange={setOpen}>
            <span data-testid="anchor" />
          </CoverPicker>
        </>
      );
    }
    mount(<Controlled />);
    const raise = () => container.querySelector("[data-testid='raise']");

    click(raise());
    click(button('UploadCover'));
    await confirmEditor({ file: fakeFile(), crop: fakeCrop() });
    await act(async () => {
      uploads.fail(new Error('network'));
      await Promise.resolve();
    });

    // Fired while the popover is still closed from this entry point too.
    expect(toast.warning).toHaveBeenCalledWith('CoverUploadFailed');

    click(raise());
    expect(problemText()).toBe('CoverUploadFailed');

    click(raise());
    click(raise());
    expect(problemText()).toBeNull();
  });
});

describe('CoverPicker reposition', () => {
  it('is not offered for a preset cover', () => {
    mount(picker(vi.fn(), 'sunset'));
    openPicker();
    expect(button('RepositionCover')).toBeNull();
  });

  it('is not offered when no cover is set', () => {
    mount(picker(vi.fn(), null));
    openPicker();
    expect(button('RepositionCover')).toBeNull();
  });

  it('is offered for a custom cover and writes only the new crop back', async () => {
    const onChange = vi.fn();
    mount(picker(onChange, 'asset:current.png', JSON.stringify(fakeCrop())));
    openPicker();

    click(button('RepositionCover'));
    await flushFetch();
    await confirmEditor({ file: null, crop: fakeCrop({ x: 0.2 }) });

    expect(onChange.mock.calls).toEqual([
      [{ cover: 'asset:current.png', coverCrop: JSON.stringify(fakeCrop({ x: 0.2 })) }],
    ]);
  });

  it('stores no crop when the reposition lands back on the whole picture', async () => {
    const onChange = vi.fn();
    mount(picker(onChange, 'asset:current.png', JSON.stringify(fakeCrop())));
    openPicker();

    click(button('RepositionCover'));
    await flushFetch();
    await confirmEditor({ file: null, crop: { x: 0, y: 0, w: 1, h: 1, aspect: 1 } });

    expect(onChange.mock.calls).toEqual([[{ cover: 'asset:current.png', coverCrop: null }]]);
  });

  it('uploads a picture dropped in during reposition and stores its own token', async () => {
    const onChange = vi.fn();
    mount(picker(onChange, 'asset:current.png', JSON.stringify(fakeCrop())));
    openPicker();

    click(button('RepositionCover'));
    await flushFetch();
    await confirmEditor({ file: fakeFile('swap.png'), crop: fakeCrop({ x: 0.3 }) });
    await settleUpload('swap.png');

    expect(onChange.mock.calls).toEqual([
      [{ cover: 'asset:swap.png', coverCrop: JSON.stringify(fakeCrop({ x: 0.3 })) }],
    ]);
  });

  it('changes nothing when the reposition is cancelled', async () => {
    const onChange = vi.fn();
    mount(picker(onChange, 'asset:current.png', JSON.stringify(fakeCrop())));
    openPicker();

    click(button('RepositionCover'));
    await flushFetch();
    await confirmEditor(null);

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('CoverPicker presets and removal', () => {
  it('clears any crop when a preset is chosen over a custom cover', () => {
    const onChange = vi.fn();
    mount(picker(onChange, 'asset:current.png', JSON.stringify(fakeCrop())));
    openPicker();

    click(swatch('meadow'));

    expect(onChange.mock.calls).toEqual([[{ cover: 'meadow', coverCrop: null }]]);
  });

  it('clears the token and the crop together on removal', () => {
    const onChange = vi.fn();
    mount(picker(onChange, 'asset:current.png', JSON.stringify(fakeCrop())));
    openPicker();

    click(button('RemoveCover'));

    expect(onChange.mock.calls).toEqual([[{ cover: null, coverCrop: null }]]);
  });
});
