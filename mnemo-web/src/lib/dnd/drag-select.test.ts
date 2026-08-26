// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { DRAGGING_CLASS, restoreTextSelection, suppressTextSelection } from './drag-select';

afterEach(() => {
  document.body.classList.remove(DRAGGING_CLASS);
});

describe('drag text-selection suppression', () => {
  it('adds the body class while a drag holds it off', () => {
    suppressTextSelection();
    expect(document.body.classList.contains(DRAGGING_CLASS)).toBe(true);
  });

  it('removes the class when the drag restores it', () => {
    suppressTextSelection();
    restoreTextSelection();
    expect(document.body.classList.contains(DRAGGING_CLASS)).toBe(false);
  });

  it('restoring with no drag up is a no-op rather than an error', () => {
    restoreTextSelection();
    expect(document.body.classList.contains(DRAGGING_CLASS)).toBe(false);
  });
});
