import type { MarkType } from 'prosemirror-model';
import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state';

import type { InputTriggerContribution } from '../registry/types';
import { currentMarks, withoutScriptMarks, type ScriptMarkName } from './marks';

type ShortcutForm = 'braced' | 'terminated';

const BRACED = /[^\s_^]([_^])\{([^{}\n]+)\}$/u;
const DIGITS = /[^\s_^]([_^])(\d+)(\D)$/u;
const CHARACTER = /[^\s_^]([_^])([^\d\s_^{}])([\s\S])$/u;
const PENDING_DIGITS = /[^\s_^]([_^])(\d+)$/u;
const PENDING_CHARACTER = /[^\s_^]([_^])([^\d\s_^{}])$/u;

function markNames(marker: string): { readonly script: ScriptMarkName; readonly partner: ScriptMarkName } {
  return marker === '^' ? { script: 'sup', partner: 'sub' } : { script: 'sub', partner: 'sup' };
}

function confidentSubscript(state: EditorState, markerPosition: number, explicit: boolean): boolean {
  if (explicit) return true;
  const lineStart = state.selection.$from.start();
  const markerOffset = markerPosition - lineStart;
  const line = state.selection.$from.parent;
  let formulaBoundary = 0;
  line.forEach((node, offset) => {
    if (
      offset < markerOffset &&
      node.marks.some((mark) => mark.type.name === 'sub' || mark.type.name === 'sup')
    ) {
      formulaBoundary = Math.max(formulaBoundary, offset + node.nodeSize);
    }
  });
  const prefix = line.textBetween(formulaBoundary, Math.max(formulaBoundary, markerOffset));
  const token = prefix.match(/[\p{L}\p{N}]+$/u)?.[0] ?? '';
  return token.length > 0 && Array.from(token).length <= 2;
}

function canApply(state: EditorState, marker: string, markerPosition: number, explicit: boolean): {
  readonly script: MarkType;
  readonly partner: MarkType;
} | null {
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || !selection.$cursor) return null;
  const names = markNames(marker);
  const script = state.schema.marks[names.script];
  const partner = state.schema.marks[names.partner];
  if (!script || !partner || !selection.$cursor.parent.type.allowsMarkType(script)) return null;
  if (marker === '_' && !confidentSubscript(state, markerPosition, explicit)) return null;
  return { script, partner };
}

function finish(state: EditorState, tr: Transaction): Transaction {
  return tr.setStoredMarks(withoutScriptMarks(currentMarks(state)));
}

function applyShortcut(
  state: EditorState,
  match: RegExpMatchArray,
  caret: number,
  form: ShortcutForm,
): Transaction | null {
  const marker = match[1];
  const content = match[2];
  if (!marker || !content) return null;

  if (form === 'braced') {
    const markerPosition = caret - content.length - 3;
    const marks = canApply(state, marker, markerPosition, true);
    if (!marks) return null;
    const contentEnd = caret - 3;
    const tr = state.tr
      .delete(caret - 1, caret)
      .delete(markerPosition, markerPosition + 2)
      .removeMark(markerPosition, contentEnd, marks.partner)
      .addMark(markerPosition, contentEnd, marks.script.create());
    return finish(state, tr);
  }

  const terminator = match[3];
  if (!terminator) return null;
  const markerPosition = caret - terminator.length - content.length - 1;
  const marks = canApply(state, marker, markerPosition, false);
  if (!marks) return null;
  const contentEnd = caret - terminator.length - 1;
  const terminatorEnd = caret - 1;
  const tr = state.tr
    .delete(markerPosition, markerPosition + 1)
    .removeMark(markerPosition, contentEnd, marks.partner)
    .addMark(markerPosition, contentEnd, marks.script.create())
    .removeMark(contentEnd, terminatorEnd, marks.script)
    .removeMark(contentEnd, terminatorEnd, marks.partner);
  return finish(state, tr);
}

export function scriptShortcutTriggers(): readonly InputTriggerContribution[] {
  return [
    {
      id: 'script.braced',
      match: BRACED,
      handler(state, match, _from, to) {
        return applyShortcut(state, match, to, 'braced');
      },
    },
    {
      id: 'script.digits',
      match: DIGITS,
      handler(state, match, _from, to) {
        return applyShortcut(state, match, to, 'terminated');
      },
    },
    {
      id: 'script.character',
      match: CHARACTER,
      handler(state, match, _from, to) {
        return applyShortcut(state, match, to, 'terminated');
      },
    },
  ];
}

export function convertPendingScriptShortcut(state: EditorState): Transaction | null {
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || !selection.$cursor) return null;
  const text = selection.$cursor.parent.textBetween(0, selection.$cursor.parentOffset);
  const match = PENDING_DIGITS.exec(text) ?? PENDING_CHARACTER.exec(text);
  if (!match) return null;

  const marker = match[1];
  const content = match[2];
  if (!marker || !content) return null;
  const caret = selection.from;
  const markerPosition = caret - content.length - 1;
  const marks = canApply(state, marker, markerPosition, false);
  if (!marks) return null;
  const tr = state.tr
    .delete(markerPosition, markerPosition + 1)
    .removeMark(markerPosition, caret - 1, marks.partner)
    .addMark(markerPosition, caret - 1, marks.script.create());
  return finish(state, tr);
}
