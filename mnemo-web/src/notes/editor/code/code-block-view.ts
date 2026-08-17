/**
 * The code block's renderer.
 *
 * The source itself stays ProseMirror's: the `<pre>` handed over as `contentDOM`
 * holds the block's `codeLine`, so the caret, undo, find and the clipboard all
 * work here exactly as they do in a paragraph, and the colour goes on as
 * decorations from the highlight plugin rather than as a second copy of the text
 * painted underneath a transparent one.
 *
 * Everything around it is view-owned and claimed by `ignoreMutation`: the line
 * number gutter, the fold, the caption field, and the container the React chrome
 * mounts into. None of them are document content, and a write to any of them
 * must not read back to ProseMirror as an edit.
 *
 * ## One undo step per gesture
 *
 * Language, wrap and line numbers each commit a single `setNodeMarkup` wrapped as
 * its own undo step. The caption is the exception: it is typed, so it commits
 * plainly and the history's own grouping delay coalesces a run of keystrokes into
 * one undo, exactly as it does for typing in the document. Holding the text in
 * the field and committing it later was the other option and it is worse: an
 * uncommitted field is text the autosave cannot see, and the note can be closed
 * on the same keystroke that ended it.
 */

import type { Node as PMNode } from 'prosemirror-model';
import { createElement } from 'react';
import type { RealizedBlockView, RealizedBlockViewArgs } from '../registry/types';
import { asOwnUndoStep } from '../history';
import { lineText } from '../blocks/shared';
import { mountPortalNodeView, type PortalNodeView } from '../view/portal-registry';
import { useI18nStore } from '../../../i18n/store';
import { createTranslate } from '../../../i18n/translate';
import { CodeChrome } from './CodeChrome';

const ROOT = 'notes-code';

/**
 * Longer than this and the block is folded until asked. Twenty-four lines is
 * about a screen of a note; past it the code stops being a quotation and starts
 * being a file you scrolled into by accident.
 */
export const CODE_FOLD_AT = 24;

/** Reads the active bundle at call time, so it follows a language change. */
function translate(key: string, params?: Record<string, string | number>): string {
  return createTranslate(useI18nStore.getState().bundle)('NotesEditor', key, params);
}

function lineCount(node: PMNode): number {
  const text = lineText(node);
  return text.length === 0 ? 1 : text.split('\n').length;
}

export function codeBlockView(
  args: RealizedBlockViewArgs<Record<string, unknown>>,
): RealizedBlockView {
  const { view, services } = args;

  const dom = document.createElement('div');
  dom.className = ROOT;

  const frame = document.createElement('div');
  frame.className = `${ROOT}-frame`;
  dom.appendChild(frame);

  const scroll = document.createElement('div');
  scroll.className = `${ROOT}-scroll scroll-thin`;
  frame.appendChild(scroll);

  const gutter = document.createElement('div');
  gutter.className = `${ROOT}-gutter`;
  gutter.setAttribute('aria-hidden', 'true');
  gutter.setAttribute('contenteditable', 'false');

  const source = document.createElement('pre');
  source.className = `${ROOT}-source`;
  scroll.appendChild(source);

  const fold = document.createElement('button');
  fold.type = 'button';
  fold.tabIndex = -1;
  fold.className = `${ROOT}-fold`;
  fold.setAttribute('contenteditable', 'false');

  const less = document.createElement('button');
  less.type = 'button';
  less.tabIndex = -1;
  less.className = `${ROOT}-less`;
  less.setAttribute('contenteditable', 'false');
  less.textContent = translate('CodeShowLess');

  const captionRow = document.createElement('div');
  captionRow.className = `${ROOT}-caption`;
  captionRow.setAttribute('contenteditable', 'false');
  const captionField = document.createElement('input');
  captionField.type = 'text';
  captionField.placeholder = translate('CodeCaptionPlaceholder');
  captionField.setAttribute('aria-label', translate('CodeCaption'));
  captionRow.appendChild(captionField);

  let currentNode = args.node;
  /** View-local: how much of a long block is showing is not a property of the note. */
  let expanded = false;
  /**
   * Whether the caption row is on screen. A caption with text is always on;
   * turning one on from the menu shows an empty field, and clicking away from an
   * empty field takes it back off, so an accidental toggle leaves no trace.
   */
  let captionOpen = String(args.node.attrs.caption ?? '').length > 0;
  let chrome: PortalNodeView | null = null;
  /** Lines the gutter is currently drawn for, so typing does not rebuild it. */
  let gutterLines = -1;

  function liveNode(): { pos: number; node: PMNode } | null {
    const pos = args.getPos();
    if (pos === undefined) return null;
    const node = view.state.doc.nodeAt(pos);
    return node && node.type === args.node.type ? { pos, node } : null;
  }

  function commitAttrs(patch: Record<string, unknown>): void {
    const live = liveNode();
    if (!live) return;
    view.dispatch(
      asOwnUndoStep(
        view.state.tr.setNodeMarkup(live.pos, undefined, { ...live.node.attrs, ...patch }),
      ),
    );
  }

  function commitCaption(): void {
    const live = liveNode();
    if (!live) return;
    if (String(live.node.attrs.caption ?? '') === captionField.value) return;
    // Not its own undo step: a caption is typed, and grouping with the keystrokes
    // around it is what makes one undo take back one edit rather than one letter.
    view.dispatch(
      view.state.tr.setNodeMarkup(live.pos, undefined, {
        ...live.node.attrs,
        caption: captionField.value,
      }),
    );
  }

  captionField.addEventListener('input', commitCaption);
  captionField.addEventListener('blur', () => {
    // An empty field that has been left is a caption nobody wanted.
    if (captionField.value.trim().length > 0 || !captionOpen) return;
    captionOpen = false;
    // Against the live node, not the last one rendered: the commit that emptied
    // the field may not have come back through `update` yet, and the stale node
    // still says there is a caption to show.
    render(liveNode()?.node ?? currentNode);
  });
  captionField.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    event.preventDefault();
    captionField.blur();
    view.focus();
  });

  fold.addEventListener('mousedown', (event) => event.preventDefault());
  fold.addEventListener('click', () => {
    expanded = true;
    render(currentNode);
  });
  less.addEventListener('mousedown', (event) => event.preventDefault());
  less.addEventListener('click', () => {
    expanded = false;
    render(currentNode);
  });

  async function copySource(): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(lineText(currentNode));
      return true;
    } catch {
      return false;
    }
  }

  function toggleCaption(): void {
    captionOpen = !captionOpen;
    if (!captionOpen && captionField.value.length > 0) commitAttrs({ caption: '' });
    render(currentNode);
    // Turning a caption on and then having to find it is the failure here.
    if (captionOpen) requestAnimationFrame(() => captionField.focus());
  }

  function renderChrome(node: PMNode): void {
    if (!view.editable || !services.portals) return;
    const element = createElement(CodeChrome, {
      language: String(node.attrs.language ?? ''),
      wrap: node.attrs.wrap === true,
      numbers: node.attrs.numbers === true,
      caption: captionOpen,
      onLanguage: (value: string) => commitAttrs({ language: value }),
      onWrap: () => commitAttrs({ wrap: !(currentNode.attrs.wrap === true) }),
      onNumbers: () => commitAttrs({ numbers: !(currentNode.attrs.numbers === true) }),
      onCaption: toggleCaption,
      onCopy: copySource,
    });
    if (chrome) {
      chrome.update(element);
      return;
    }
    chrome = mountPortalNodeView(services.portals, element, { className: `${ROOT}-chrome-mount` });
    frame.insertBefore(chrome.dom, scroll);
  }

  function renderGutter(node: PMNode): void {
    const wanted = node.attrs.numbers === true;
    if (!wanted) {
      gutter.remove();
      gutterLines = -1;
      return;
    }
    if (gutter.parentNode !== scroll) scroll.insertBefore(gutter, source);
    const lines = lineCount(node);
    if (lines === gutterLines) return;
    gutterLines = lines;
    // Reserve the width the highest number needs, so the source does not shift
    // sideways as the block crosses ten, a hundred, a thousand lines.
    gutter.style.minWidth = `${String(lines).length + 1}ch`;
    const rows = document.createDocumentFragment();
    for (let i = 1; i <= lines; i++) {
      const row = document.createElement('div');
      row.textContent = String(i);
      rows.appendChild(row);
    }
    gutter.replaceChildren(rows);
  }

  function render(node: PMNode): void {
    currentNode = node;
    dom.setAttribute('data-language', String(node.attrs.language ?? ''));
    dom.toggleAttribute('data-wrap', node.attrs.wrap === true);

    const lines = lineCount(node);
    const folded = lines > CODE_FOLD_AT && !expanded;
    frame.toggleAttribute('data-folded', folded);
    if (folded) {
      fold.textContent = translate('CodeShowAll', { 0: lines });
      if (fold.parentNode !== frame) frame.appendChild(fold);
    } else {
      fold.remove();
    }
    if (expanded && lines > CODE_FOLD_AT) {
      if (less.parentNode !== dom) frame.after(less);
    } else {
      less.remove();
    }

    renderGutter(node);

    const caption = String(node.attrs.caption ?? '');
    if (caption.length > 0) captionOpen = true;
    if (captionOpen) {
      // Only when they disagree: writing the value back on every render would
      // reset the cursor to the end while the field is being typed in.
      if (captionField.value !== caption && document.activeElement !== captionField) {
        captionField.value = caption;
      }
      if (captionRow.parentNode !== dom) dom.appendChild(captionRow);
      captionField.readOnly = !view.editable;
    } else {
      captionRow.remove();
    }

    renderChrome(node);
  }

  render(args.node);

  return {
    dom,
    contentDOM: source,
    update(node: PMNode): boolean {
      if (node.type !== args.node.type) return false;
      render(node);
      return true;
    },
    ignoreMutation(mutation) {
      // The caret and every edit to the source belong to ProseMirror.
      if (mutation.type === 'selection') return false;
      if (source.contains(mutation.target)) return false;
      // The gutter, the fold, the caption and the chrome mount are this view's,
      // and rebuilding any of them must not tear the NodeView down.
      return true;
    },
    destroy(): void {
      chrome?.destroy();
      chrome = null;
    },
  };
}
