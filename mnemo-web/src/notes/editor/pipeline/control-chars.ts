/**
 * Control characters a note should never store: the C0 range and DEL, other than tab and newline.
 * Stored, one renders as a missing-glyph box. Typed input and paste are cleaned where they arrive;
 * {@link controlCharGuard} catches the rest (drops, IME commits, autocorrect). Code blocks are not
 * exempt. Existing notes are not swept on load: a stored character goes when its text is next
 * edited, so no note is marked dirty for it.
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { isHistoryRestore } from '../history';
import { changedRanges } from './invariants';

/** Compared by code rather than a regex range, which lint rightly flags as a likely typo. */
function isDisallowedControlChar(text: string, i: number): boolean {
  const code = text.charCodeAt(i);
  return code === 0x7f || (code <= 0x1f && code !== 0x09 && code !== 0x0a);
}

/** Removes every disallowed control character from `text`, tab and newline kept. */
export function stripControlChars(text: string): string {
  let changed = false;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    if (isDisallowedControlChar(text, i)) {
      changed = true;
      continue;
    }
    out += text[i];
  }
  return changed ? out : text;
}

/**
 * Reads CR, CRLF, vertical tab and form feed as newlines, so pasted text from old Mac files or
 * Word keeps its line breaks instead of having them stripped as control characters.
 */
export function normalizeLineBreaks(text: string): string {
  return text.replace(/\r\n|\r|\v|\f/g, '\n');
}

/**
 * Cleans typed input. Declines while composing, since the IME candidate is not what will land;
 * a composed control character is caught by {@link controlCharGuard} afterwards.
 */
export function controlCharTextInputGuard(): Plugin {
  return new Plugin({
    props: {
      handleTextInput(view: EditorView, from: number, to: number, text: string) {
        if (view.composing) return false;
        const clean = stripControlChars(text);
        if (clean === text) return false;
        view.dispatch(view.state.tr.insertText(clean, from, to).scrollIntoView());
        return true;
      },
    },
  });
}

const controlCharKey = new PluginKey('mnemo-control-char-guard');

/**
 * The backstop, shaped like `invariantPipeline`: scans only the changed ranges, tags its own
 * transaction so it cannot retrigger, and stays out of history restores.
 */
export function controlCharGuard(): Plugin {
  return new Plugin({
    key: controlCharKey,
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      if (transactions.every((tr) => tr.getMeta(controlCharKey) === true)) return null;
      if (transactions.some(isHistoryRestore)) return null;

      const ranges = changedRanges(transactions);
      if (ranges.length === 0) return null;

      // A set: two ranges in one text node each rescan the whole node, and a
      // position recorded twice would delete a real character the second time.
      const positions = new Set<number>();
      for (const range of ranges) {
        const from = Math.max(0, range.from);
        const to = Math.min(newState.doc.content.size, range.to);
        if (from >= to) continue;
        newState.doc.nodesBetween(from, to, (node, pos) => {
          if (!node.isText) return true;
          const original = node.text ?? '';
          for (let i = 0; i < original.length; i++) {
            if (isDisallowedControlChar(original, i)) positions.add(pos + i);
          }
          return true;
        });
      }
      if (positions.size === 0) return null;

      // One delete per character, right to left, so the selection and marks map
      // through; replacing the whole text node threw the caret.
      const sorted = Array.from(positions).sort((a, b) => b - a);
      const tr = newState.tr;
      for (const at of sorted) tr.delete(at, at + 1);
      tr.setMeta(controlCharKey, true);
      return tr;
    },
  });
}
