// @vitest-environment jsdom

/**
 * Arrowing into a caption that is not on the page.
 *
 * The caption line is mandatory and clipped rather than removed, so the caret can reach a line
 * with no height and no ink. Nothing about a selection move reaches a NodeView on its own, which
 * is why the caret is a decoration; this pins both halves, the decoration itself and the class
 * arriving on the figure the view drew.
 */

import { describe, expect, it } from 'vitest';
import { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { block, span } from '../mapper/fixtures';
import { resolveServices, toNodeViews } from '../view/nodeviews';
import { CAPTION_CARET_CLASS, captionCaretDecorationSet, imageCaptionCaretDecorations } from './image-caption-caret';

function note(caption: string) {
  const built = buildNoteEditState([
    block('Text', [span('before')]),
    block('Image', [span(caption)], {
      kind: 'image',
      path: '',
      alt: caption,
      width: 0,
      align: 'left',
      crop: null,
    }),
  ]);
  if (!built.ok) throw new Error('fixture did not build');
  return built;
}

/** Position just before the image block, which is the second child. */
function imagePos(doc: { child: (index: number) => { nodeSize: number } }): number {
  return doc.child(0).nodeSize;
}

describe('imageCaptionCaretDecorations', () => {
  it('marks the image whose caption holds the caret, and nothing otherwise', () => {
    const built = note('');
    const at = imagePos(built.state.doc);

    expect(imageCaptionCaretDecorations(built.state)).toHaveLength(0);

    const inCaption = built.state.apply(
      built.state.tr.setSelection(TextSelection.near(built.state.doc.resolve(at + 1), 1)),
    );
    const decorations = imageCaptionCaretDecorations(inCaption);
    expect(decorations).toHaveLength(1);
    expect(decorations[0].from).toBe(at);
    expect(decorations[0].to).toBe(at + built.state.doc.child(1).nodeSize);

    const backInProse = inCaption.apply(
      inCaption.tr.setSelection(TextSelection.near(inCaption.doc.resolve(1), 1)),
    );
    expect(imageCaptionCaretDecorations(backInProse)).toHaveLength(0);
  });
});

describe('the plugin state', () => {
  it('reuses the same decoration set across a keystroke that stays in the same caption', () => {
    const built = note('Fig 1');
    const at = imagePos(built.state.doc);
    const inCaption = built.state.apply(
      built.state.tr.setSelection(TextSelection.near(built.state.doc.resolve(at + 1), 1)),
    );
    const before = captionCaretDecorationSet(inCaption);
    expect(before).toBeDefined();

    // Typing inside the caption changes the document on every keystroke, but the caret stays in
    // the same picture's caption, at the same node position: the walk that rebuilds the set has
    // nothing new to find and should not run again.
    const typed = inCaption.apply(inCaption.tr.insertText('!', inCaption.selection.from));
    const after = captionCaretDecorationSet(typed);
    expect(after).toBe(before);
  });

  it('rebuilds once the caret leaves the caption', () => {
    const built = note('Fig 1');
    const at = imagePos(built.state.doc);
    const inCaption = built.state.apply(
      built.state.tr.setSelection(TextSelection.near(built.state.doc.resolve(at + 1), 1)),
    );
    const before = captionCaretDecorationSet(inCaption);

    const backInProse = inCaption.apply(
      inCaption.tr.setSelection(TextSelection.near(inCaption.doc.resolve(1), 1)),
    );
    const after = captionCaretDecorationSet(backInProse);
    expect(after).not.toBe(before);
  });
});

describe('a caption the caret has arrived in', () => {
  it('is revealed while the caret is there and hidden again once it leaves', () => {
    const built = note('');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const view = new EditorView(host, {
      state: built.state,
      nodeViews: toNodeViews(built.registry, resolveServices()),
    });

    const at = imagePos(view.state.doc);
    const figure = view.nodeDOM(at);
    if (!(figure instanceof HTMLElement)) throw new Error('the image did not render');

    // An empty caption nobody asked for is out of the way, but still in the document.
    expect(figure.getAttribute('data-caption')).toBe('hidden');
    expect(figure.classList.contains(CAPTION_CARET_CLASS)).toBe(false);
    expect(figure.querySelector('.notes-image-caption')).not.toBeNull();

    // What arrowing down produces: the caret one position into the block, which is the line.
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at + 1), 1)));
    expect(figure.classList.contains(CAPTION_CARET_CLASS)).toBe(true);
    expect(figure.getAttribute('data-caption')).toBe('hidden');

    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(1), 1)));
    expect(figure.classList.contains(CAPTION_CARET_CLASS)).toBe(false);

    view.destroy();
    document.body.replaceChildren();
  });

  it('is on the page from the start when it has something in it', () => {
    const built = note('Figure 1');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const view = new EditorView(host, {
      state: built.state,
      nodeViews: toNodeViews(built.registry, resolveServices()),
    });

    const figure = view.nodeDOM(imagePos(view.state.doc));
    if (!(figure instanceof HTMLElement)) throw new Error('the image did not render');
    expect(figure.getAttribute('data-caption')).toBe('shown');

    view.destroy();
    document.body.replaceChildren();
  });
});
