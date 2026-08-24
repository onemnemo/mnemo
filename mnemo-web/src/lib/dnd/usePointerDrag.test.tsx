// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePointerDrag, type PointerDrag, type PointerDragOptions } from './usePointerDrag';
import { DRAGGING_CLASS } from './drag-select';

interface Handle {
  id: string;
}
type Target = { where: string };
type Plan = { moved: string };

// A React 19 concurrent-root harness: no @testing-library needed, just a hook
// captured into a module ref and driven with real window events.
let api: PointerDrag<Handle, Target> | null = null;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Harness({ options }: { options: PointerDragOptions<Handle, Target, Plan> }) {
  api = usePointerDrag(options);
  return null;
}

function render(options: PointerDragOptions<Handle, Target, Plan>) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<Harness options={options} />);
  });
}

function unmount() {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
  api = null;
}

/** A synthetic press event carrying only what the hook reads. */
function pressEvent(x: number, y: number): Parameters<PointerDrag<Handle, Target>['press']>[0] {
  const target = document.createElement('button');
  return { button: 0, pointerType: 'mouse', pointerId: 1, clientX: x, clientY: y, target } as never;
}

function windowEvent(type: string, x: number, y: number) {
  const event = new Event(type) as Event & { clientX: number; clientY: number; pointerId: number };
  event.clientX = x;
  event.clientY = y;
  event.pointerId = 1;
  return event;
}

function fire(event: Event) {
  act(() => {
    window.dispatchEvent(event);
  });
}

function baseOptions(over: Partial<PointerDragOptions<Handle, Target, Plan>> = {}): PointerDragOptions<Handle, Target, Plan> {
  return {
    getKey: (handle) => handle.id,
    resolve: () => ({ where: 'target' }),
    plan: () => ({ moved: 'plan' }),
    onDrop: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  document.body.classList.remove(DRAGGING_CLASS);
});

afterEach(() => {
  if (root) unmount();
  document.body.classList.remove(DRAGGING_CLASS);
});

describe('usePointerDrag state machine', () => {
  it('does not arm a drag below the start threshold', () => {
    const onDrop = vi.fn();
    render(baseOptions({ onDrop }));
    act(() => {
      api!.press(pressEvent(100, 100), { id: 'a' });
    });
    fire(windowEvent('pointermove', 103, 103)); // within 5px on both axes
    expect(api!.handle).toBeNull();
    fire(windowEvent('pointerup', 103, 103));
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('arms past the threshold and commits the planned drop on release', () => {
    const onDrop = vi.fn();
    render(baseOptions({ onDrop }));
    act(() => {
      api!.press(pressEvent(100, 100), { id: 'a' });
    });
    fire(windowEvent('pointermove', 110, 110)); // armed, but under the 24px commit distance
    expect(api!.handle).toEqual({ id: 'a' });
    expect(api!.target).toBeNull();
    fire(windowEvent('pointermove', 140, 140)); // past commit distance: a target appears
    expect(api!.target).toEqual({ where: 'target' });
    fire(windowEvent('pointerup', 140, 140));
    expect(onDrop).toHaveBeenCalledExactlyOnceWith({ moved: 'plan' });
    expect(api!.handle).toBeNull();
    expect(document.body.classList.contains(DRAGGING_CLASS)).toBe(false);
  });

  it('does not commit when the plan is null', () => {
    const onDrop = vi.fn();
    render(baseOptions({ plan: () => null, onDrop }));
    act(() => {
      api!.press(pressEvent(100, 100), { id: 'a' });
    });
    fire(windowEvent('pointermove', 140, 140));
    expect(api!.target).toBeNull();
    fire(windowEvent('pointerup', 140, 140));
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('Escape cancels an armed drag without committing and clears the selection lock', () => {
    const onDrop = vi.fn();
    render(baseOptions({ onDrop }));
    act(() => {
      api!.press(pressEvent(100, 100), { id: 'a' });
    });
    fire(windowEvent('pointermove', 140, 140));
    expect(document.body.classList.contains(DRAGGING_CLASS)).toBe(true);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onDrop).not.toHaveBeenCalled();
    expect(api!.handle).toBeNull();
    expect(document.body.classList.contains(DRAGGING_CLASS)).toBe(false);
  });

  it('pointercancel tears the drag down without committing', () => {
    const onDrop = vi.fn();
    render(baseOptions({ onDrop }));
    act(() => {
      api!.press(pressEvent(100, 100), { id: 'a' });
    });
    fire(windowEvent('pointermove', 140, 140));
    fire(windowEvent('pointercancel', 140, 140));
    expect(onDrop).not.toHaveBeenCalled();
    expect(api!.handle).toBeNull();
    expect(document.body.classList.contains(DRAGGING_CLASS)).toBe(false);
  });

  it('unmounting mid-drag clears the body selection lock', () => {
    render(baseOptions());
    act(() => {
      api!.press(pressEvent(100, 100), { id: 'a' });
    });
    fire(windowEvent('pointermove', 140, 140));
    expect(document.body.classList.contains(DRAGGING_CLASS)).toBe(true);
    unmount();
    expect(document.body.classList.contains(DRAGGING_CLASS)).toBe(false);
  });

  it('suppresses exactly one trailing click on the dragged key', () => {
    const onDrop = vi.fn();
    render(baseOptions({ onDrop }));
    act(() => {
      api!.press(pressEvent(100, 100), { id: 'a' });
    });
    fire(windowEvent('pointermove', 140, 140));
    fire(windowEvent('pointerup', 140, 140));
    expect(api!.suppressClick('a')).toBe(true);
    // The suppression is spent; a second click is a real one.
    expect(api!.suppressClick('a')).toBe(false);
  });

  it('ignores a press that starts inside an ignored selector', () => {
    const onDrop = vi.fn();
    render(baseOptions({ ignorePressWithin: 'button', onDrop }));
    const event = pressEvent(100, 100); // target is a <button>
    act(() => {
      api!.press(event, { id: 'a' });
    });
    fire(windowEvent('pointermove', 140, 140));
    expect(api!.handle).toBeNull();
  });
});
