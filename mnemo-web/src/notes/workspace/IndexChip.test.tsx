// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { EditorView } from 'prosemirror-view';

import { buildNoteEditState } from '../edit/build-edit-state';
import { block, span } from '../editor/mapper/fixtures';
import { IndexChip } from './IndexChip';

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  frames = new Map();
  nextFrame = 1;
  vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => {
    frames.set(nextFrame, run);
    return nextFrame++;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function renderChip(headingCount: number) {
  const built = buildNoteEditState(Array.from({ length: headingCount }, (_, i) => block('Heading2', [span(`Section ${String(i)}`)])));
  if (!built.ok) throw new Error('fixture did not build');
  const measured: number[] = [];
  const view = {
    state: built.state,
    coordsAtPos: (pos: number) => {
      measured.push(pos);
      return { top: pos * 10, bottom: pos * 10, left: 0, right: 0 };
    },
  } as unknown as EditorView;
  const scroller = document.createElement('div');
  // Read far down the note, where a top-down scan would measure every heading.
  scroller.getBoundingClientRect = () => ({ top: 1e9 }) as DOMRect;
  const scrollRef = createRef<HTMLElement>() as { current: HTMLElement | null };
  scrollRef.current = scroller;
  act(() => root.render(<IndexChip view={view} registry={built.registry} scrollRef={scrollRef} />));
  return { scroller, measured };
}

describe('IndexChip scroll tracking', () => {
  it('coalesces a burst of scroll events into one frame of a few measurements', () => {
    const { scroller, measured } = renderChip(500);
    measured.length = 0;

    act(() => {
      for (let i = 0; i < 20; i++) scroller.dispatchEvent(new Event('scroll'));
    });
    expect(frames.size).toBe(1);
    expect(measured).toEqual([]);

    act(() => {
      for (const run of frames.values()) run(0);
    });
    expect(measured.length).toBeGreaterThan(0);
    expect(measured.length).toBeLessThanOrEqual(10);
  });

  it('cancels a pending frame when it unmounts', () => {
    const { scroller } = renderChip(3);
    act(() => scroller.dispatchEvent(new Event('scroll')));
    expect(frames.size).toBe(1);

    act(() => root.unmount());
    root = createRoot(host);
    expect(frames.size).toBe(0);
  });
});
