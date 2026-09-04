// @vitest-environment jsdom

/**
 * How a marked word is asked about, and what is deliberately left alone.
 *
 * The right-click case is the one worth pinning. The editor's own context menu
 * is a bubble-phase listener on the container above the view, so an earlier
 * handler here that claimed the event took Cut, Copy and Paste away from every
 * misspelled word. Nothing on this path may stop that event or cancel it.
 */

import { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import { afterEach, describe, expect, it } from 'vitest';

import { buildNoteEditState } from '../edit/build-edit-state';
import { installCardTriggers } from './card-triggers';
import { blockOf, liveSegmentIds, locatedIssueFor, text } from './fixtures';
import { proofingKey } from './proofing-plugin';

afterEach(() => {
  document.body.replaceChildren();
});

function harness(value: string, word: string) {
  const built = buildNoteEditState([blockOf({ sid: 'a', spans: [text(value)] })]);
  if (!built.ok) throw new Error('quarantined');

  // The wrapper stands in for the container the editor's context menu is bound
  // to: it is an ancestor of view.dom and it listens in the bubble phase.
  const wrapper = document.createElement('div');
  document.body.appendChild(wrapper);
  const mount = document.createElement('div');
  wrapper.appendChild(mount);

  const view = new EditorView(mount, { state: built.state });
  const located = locatedIssueFor(view.state.doc, 'a', word);
  view.dispatch(
    view.state.tr.setMeta(proofingKey, {
      type: 'answers',
      liveSegmentIds: liveSegmentIds(view.state.doc),
      segmentIds: [located.issue.segmentId],
      issues: [located],
    }),
  );

  const opened: string[] = [];
  const ancestorSaw: string[] = [];
  wrapper.addEventListener('contextmenu', (event) => ancestorSaw.push(event.type));

  const uninstall = installCardTriggers(view, {
    isOpen: () => false,
    open: (hit) => opened.push(hit.located.issue.text),
  });

  const mark = view.dom.querySelector('.proof-mark');
  if (!(mark instanceof HTMLElement)) throw new Error('the mark was not rendered');

  return {
    view,
    mark,
    opened,
    ancestorSaw,
    located,
    caretInsideMark() {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, located.from + 1)));
    },
    caretOutsideMark() {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.content.size - 1)));
    },
    destroy() {
      uninstall();
      view.destroy();
    },
  };
}

function key(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('the card triggers', () => {
  it('opens on a left click on a marked word', () => {
    const h = harness('wrold cat sat', 'wrold');
    h.mark.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    expect(h.opened).toEqual(['wrold']);
    h.destroy();
  });

  it('ignores a left click on unmarked text', () => {
    const h = harness('wrold cat sat', 'wrold');
    h.view.dom.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    expect(h.opened).toHaveLength(0);
    h.destroy();
  });

  it('leaves a right click on a marked word to the editor menu', () => {
    const h = harness('wrold cat sat', 'wrold');
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    h.mark.dispatchEvent(event);

    expect(h.opened).toHaveLength(0);
    // Both halves of the regression: the event still reaches the container the
    // editor's own menu is bound to, and nothing has cancelled it.
    expect(h.ancestorSaw).toEqual(['contextmenu']);
    expect(event.defaultPrevented).toBe(false);
    h.destroy();
  });

  it('opens on the chord with the caret inside a mark', () => {
    const h = harness('wrold cat sat', 'wrold');
    h.caretInsideMark();
    const event = key(h.view.dom, { key: 'Enter', altKey: true });

    expect(h.opened).toEqual(['wrold']);
    expect(event.defaultPrevented).toBe(true);
    h.destroy();
  });

  it('declines the chord with the caret outside every mark', () => {
    const h = harness('wrold cat sat', 'wrold');
    h.caretOutsideMark();
    const event = key(h.view.dom, { key: 'Enter', altKey: true });

    expect(h.opened).toHaveLength(0);
    expect(event.defaultPrevented).toBe(false);
    h.destroy();
  });

  it('declines a chord something ahead of it has already claimed', () => {
    const h = harness('wrold cat sat', 'wrold');
    h.caretInsideMark();
    h.view.dom.addEventListener('keydown', (event) => event.preventDefault(), { once: true, capture: true });
    key(h.view.dom, { key: 'Enter', altKey: true });

    expect(h.opened).toHaveLength(0);
    h.destroy();
  });

  it('declines plain Enter, which still belongs to the document', () => {
    const h = harness('wrold cat sat', 'wrold');
    h.caretInsideMark();
    const before = h.view.state.doc;
    key(h.view.dom, { key: 'Enter' });

    expect(h.opened).toHaveLength(0);
    // The editor's own split still happened, which is the half of this that a
    // greedy handler here would have taken.
    expect(h.view.state.doc).not.toBe(before);
    h.destroy();
  });
});
