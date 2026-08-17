// @vitest-environment jsdom

/**
 * The code block's view: that the source stays ProseMirror's and everything else
 * stays the view's.
 *
 * The failure this is written against is the one a NodeView with chrome inside an
 * editable block always has: the caret. The `<pre>` is handed over as
 * `contentDOM` and nothing else may be, the gutter and the caption must be out of
 * the caret's reach, and a write to either must not read back as an edit.
 */

import { describe, expect, it } from 'vitest';
import { EditorState, type Transaction } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

import { createEditorSchema } from '../schema';
import { resolveServices } from '../view/nodeviews';
import type { BlockShellHost, RealizedBlockViewArgs } from '../registry/types';
import { codeBlockView, CODE_FOLD_AT } from './code-block-view';

const { schema } = createEditorSchema();
const host: BlockShellHost = { mode: 'realized', requestMode() {}, destroy() {} };

function mount(
  source: string,
  attrs: Record<string, unknown> = {},
  editable = true,
) {
  const node = schema.nodes.codeBlock.create(
    { language: 'typescript', ...attrs },
    schema.nodes.codeLine.create(null, source.length > 0 ? schema.text(source) : null),
  );
  const doc = schema.nodes.doc.create(null, [node]);
  let state = EditorState.create({ schema, doc });
  const view = {
    get state() {
      return state;
    },
    editable,
    focus() {},
    dispatch(tr: Transaction) {
      state = state.apply(tr);
    },
  } as unknown as EditorView;

  const args: RealizedBlockViewArgs<Record<string, unknown>> = {
    node: doc.firstChild!,
    view,
    getPos: () => 0,
    attrs: doc.firstChild!.attrs,
    host,
    // No portal registry: the interactive toolbar is React, and a harness with no
    // React tree beside it must still get a working block.
    services: resolveServices(),
  };
  const realized = codeBlockView(args);
  return {
    realized,
    /** Re-runs the view against the live document, the way ProseMirror would. */
    refresh(): PMNode {
      const next = state.doc.firstChild!;
      realized.update!(next);
      return next;
    },
    attrsNow: () => state.doc.firstChild!.attrs,
  };
}

const lines = (count: number): string => Array.from({ length: count }, (_, i) => `line ${i}`).join('\n');

describe('code block NodeView', () => {
  it('hands ProseMirror the source and nothing else', () => {
    const { realized } = mount('const a = 1;');
    expect(realized.contentDOM).toBe(realized.dom.querySelector('.notes-code-source'));
    expect(realized.contentDOM?.tagName).toBe('PRE');
  });

  it('renders without a portal registry, minus the toolbar', () => {
    const { realized } = mount('const a = 1;');
    expect(realized.dom.querySelector('.notes-code-chrome-mount')).toBeNull();
    expect(realized.contentDOM).not.toBeNull();
  });

  it('keeps the gutter out of the caret and off the copy', () => {
    const { realized } = mount('a\nb\nc', { numbers: true });
    const gutter = realized.dom.querySelector('.notes-code-gutter')!;
    expect(gutter.getAttribute('contenteditable')).toBe('false');
    expect(gutter.getAttribute('aria-hidden')).toBe('true');
    // The gutter lives outside contentDOM, so it is not document text.
    expect(realized.contentDOM!.contains(gutter)).toBe(false);
    expect([...gutter.children].map((row) => row.textContent)).toEqual(['1', '2', '3']);
  });

  it('draws no gutter until line numbers are asked for', () => {
    const { realized } = mount('a\nb');
    expect(realized.dom.querySelector('.notes-code-gutter')).toBeNull();
  });

  it('folds a block past the cutoff and unfolds on the button', () => {
    const { realized } = mount(lines(CODE_FOLD_AT + 6));
    const frame = realized.dom.querySelector('.notes-code-frame')!;
    expect(frame.hasAttribute('data-folded')).toBe(true);
    const fold = realized.dom.querySelector('.notes-code-fold') as HTMLButtonElement;
    expect(fold).not.toBeNull();

    fold.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(frame.hasAttribute('data-folded')).toBe(false);
    expect(realized.dom.querySelector('.notes-code-less')).not.toBeNull();
  });

  it('leaves a short block unfolded', () => {
    const { realized } = mount(lines(CODE_FOLD_AT));
    expect(realized.dom.querySelector('.notes-code-frame')!.hasAttribute('data-folded')).toBe(false);
    expect(realized.dom.querySelector('.notes-code-fold')).toBeNull();
  });

  it('shows a stored caption and commits an edit to it', () => {
    const { realized, refresh, attrsNow } = mount('a', { caption: 'figure one' });
    const field = realized.dom.querySelector('.notes-code-caption input') as HTMLInputElement;
    expect(field.value).toBe('figure one');

    field.value = 'figure two';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    expect(attrsNow().caption).toBe('figure two');
    // The commit re-renders through update(), which must not fight the field.
    refresh();
    expect(field.value).toBe('figure two');
  });

  it('drops an empty caption row when it is left alone', () => {
    const { realized } = mount('a', { caption: 'x' });
    const field = realized.dom.querySelector('.notes-code-caption input') as HTMLInputElement;
    field.value = '';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('blur', { bubbles: true }));
    expect(realized.dom.querySelector('.notes-code-caption')).toBeNull();
  });

  it('mirrors the wrap attr onto the block', () => {
    const { realized, refresh } = mount('a', { wrap: true });
    expect(realized.dom.hasAttribute('data-wrap')).toBe(true);
    refresh();
    expect(realized.dom.getAttribute('data-language')).toBe('typescript');
  });

  it('claims every mutation outside the source', () => {
    const { realized } = mount('a', { numbers: true, caption: 'c' });
    const gutter = realized.dom.querySelector('.notes-code-gutter')!;
    const source = realized.contentDOM!;
    const own = { type: 'childList', target: gutter } as never;
    const theirs = { type: 'childList', target: source } as never;
    expect(realized.ignoreMutation!(own)).toBe(true);
    expect(realized.ignoreMutation!(theirs)).toBe(false);
    // A selection change is always ProseMirror's to read.
    expect(realized.ignoreMutation!({ type: 'selection', target: gutter } as never)).toBe(false);
  });

  it('locks the caption on a read-only note', () => {
    const { realized } = mount('a', { caption: 'c' }, false);
    const field = realized.dom.querySelector('.notes-code-caption input') as HTMLInputElement;
    expect(field.readOnly).toBe(true);
  });
});
