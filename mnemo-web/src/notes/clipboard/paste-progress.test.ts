// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  pasteProgressSnapshot,
  storePasteProgress,
  subscribePasteProgress,
} from './paste-progress';

afterEach(() => storePasteProgress.end());

describe('paste progress store', () => {
  it('starts idle', () => {
    expect(pasteProgressSnapshot().active).toBe(false);
  });

  it('notifies subscribers on begin, advance and end', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePasteProgress(listener);
    const onCancel = () => {};

    storePasteProgress.begin(3, onCancel);
    expect(pasteProgressSnapshot()).toMatchObject({ active: true, total: 3, done: 0, onCancel });

    storePasteProgress.advance(2);
    expect(pasteProgressSnapshot().done).toBe(2);

    storePasteProgress.end();
    expect(pasteProgressSnapshot().active).toBe(false);

    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
  });

  it('keeps a stable snapshot reference while idle', () => {
    expect(pasteProgressSnapshot()).toBe(pasteProgressSnapshot());
  });

  it('ignores advance and end while idle', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePasteProgress(listener);
    storePasteProgress.advance(1);
    storePasteProgress.end();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
