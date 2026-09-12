import type { Mark } from 'prosemirror-model';
import { TextSelection, type Command, type EditorState } from 'prosemirror-state';

export type ScriptMarkName = 'sub' | 'sup';

export function scriptMarkName(marks: readonly Mark[]): ScriptMarkName | null {
  if (marks.some((mark) => mark.type.name === 'sup')) return 'sup';
  if (marks.some((mark) => mark.type.name === 'sub')) return 'sub';
  return null;
}

export function withoutScriptMarks(marks: readonly Mark[]): readonly Mark[] {
  return marks.filter((mark) => mark.type.name !== 'sub' && mark.type.name !== 'sup');
}

export function currentMarks(state: EditorState): readonly Mark[] {
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || !selection.$cursor) return [];
  return state.storedMarks ?? selection.$cursor.marks();
}

/** Escape ends a script the user explicitly armed without clearing other formatting. */
export const clearStoredScripts: Command = (state, dispatch) => {
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || !selection.$cursor || !state.storedMarks) return false;
  if (!scriptMarkName(state.storedMarks)) return false;
  if (dispatch) dispatch(state.tr.setStoredMarks(withoutScriptMarks(state.storedMarks)));
  return true;
};
