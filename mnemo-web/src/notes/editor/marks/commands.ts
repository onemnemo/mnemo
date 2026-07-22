/**
 * The custom inline-format toggle command.
 *
 * Deliberately NOT ProseMirror's stock `toggleMark`. Two behaviours the Avalonia
 * editor guarantees are ones `toggleMark` gets wrong, so this reproduces
 * `InlineSpanFormatApplier.Apply` + `TextStyle.WithToggle` instead:
 *
 *  - **Decision rule.** `toggleMark` strips a mark that appears *anywhere* in the
 *    selection. Mnemo sets the mark unless *every* span in the range already has
 *    it, so formatting a half-formatted selection finishes the job rather than
 *    clearing the part that was already formatted. That is the behaviour the
 *    corpus was authored under.
 *
 *  - **Swatch replace.** A swatch mark carries a design token. Toggling
 *    `swatch5` over a run already coloured `swatch3` must *replace* the token,
 *    not clear the colour, `toggleMark` is attr-blind and would clear. Here the
 *    "already has it" test is token-aware; a different token is therefore a set,
 *    and same-type mark exclusion makes that set replace.
 *
 * Sub/sup exclusion lives here, not in the schema. `MarkSpec.excludes` would
 * evict `sup` inside `addToSet`, but the wire format represents subscript and
 * superscript both-true and the frozen fixture actually contains it, so the
 * schema must stay able to express that state. C# clears the pair in the command
 * layer (`WithSet`), so this does too.
 *
 * A collapsed caret maps to `storedMarks`: toggling with nothing selected arms
 * the mark for the next character typed (sticky mode). Real `<sub>`/`<sup>` then
 * type at the right size for free, with no glyph sampling.
 */

import { TextSelection, type Command, type EditorState, type SelectionRange } from 'prosemirror-state';
import type { Mark, MarkType, Node as PMNode } from 'prosemirror-model';
import { asOwnUndoStep } from '../history';

/**
 * The sticky-typing escape: force the next character to carry no marks, even
 * where the caret sits inside formatted text and would otherwise inherit it.
 *
 * This is the case an inherited-format model cannot express. `setStoredMarks([])`
 * is not `setStoredMarks(null)`, null means "inherit from the caret position",
 * the empty array means "explicitly none", which is the whole point. Refuses on a
 * range (there is nothing to arm) and when there is nothing to clear, so a
 * keybinding falls through instead of consuming the key for a no-op.
 */
export const clearStoredMarks: Command = (state, dispatch) => {
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || !sel.$cursor) return false;
  const current = state.storedMarks ?? sel.$cursor.marks();
  if (current.length === 0) return false;
  if (dispatch) dispatch(state.tr.setStoredMarks([]));
  return true;
};

type FlagKind = 'bold' | 'italic' | 'underline' | 'strikethrough' | 'code' | 'highlight';
export type SwatchKind = 'backgroundColor' | 'foregroundColor';
type ScriptKind = 'subscript' | 'superscript';

/** The inline formats a plain toggle applies. Link is set via a URL, not toggled. */
export type ToggleKind = FlagKind | SwatchKind | ScriptKind;

interface Policy {
  readonly markName: string;
  readonly family: 'flag' | 'swatch' | 'script';
  /** The mark this one clears when it is set, sub/sup only. */
  readonly excludes?: string;
}

/** Kind → schema mark and toggle family. The one place the mapping lives. */
const POLICY: Record<ToggleKind, Policy> = {
  bold: { markName: 'strong', family: 'flag' },
  italic: { markName: 'em', family: 'flag' },
  underline: { markName: 'underline', family: 'flag' },
  strikethrough: { markName: 'strike', family: 'flag' },
  code: { markName: 'codeMark', family: 'flag' },
  highlight: { markName: 'highlight', family: 'flag' },
  backgroundColor: { markName: 'bgSwatch', family: 'swatch' },
  foregroundColor: { markName: 'fgSwatch', family: 'swatch' },
  subscript: { markName: 'sub', family: 'script', excludes: 'sup' },
  superscript: { markName: 'sup', family: 'script', excludes: 'sub' },
};

function markOfType(marks: readonly Mark[], type: MarkType): Mark | undefined {
  return marks.find((m) => m.type === type);
}

function swatchToken(mark: Mark | undefined): string | null {
  if (!mark) return null;
  return typeof mark.attrs.token === 'string' ? mark.attrs.token : null;
}

/**
 * Whether the mark can apply anywhere in the selection at all, false inside a
 * code block, whose content admits no marks. PM's own `toggleMark` guards the
 * same way; without it a toolbar toggle in a code block would report success and
 * silently do nothing.
 */
function markApplies(doc: PMNode, ranges: readonly SelectionRange[], type: MarkType): boolean {
  for (const { $from, $to } of ranges) {
    let can = $from.depth === 0 ? doc.type.allowsMarkType(type) : false;
    doc.nodesBetween($from.pos, $to.pos, (node) => {
      if (can) return false;
      can = node.inlineContent && node.type.allowsMarkType(type);
      return true;
    });
    if (can) return true;
  }
  return false;
}

/**
 * The "every span already has it" test that decides clear vs set. Attr-aware:
 * for a swatch, "has it" means the exact token, which is what turns a
 * different-token toggle into a replace instead of a clear.
 */
function rangeAllHave(
  doc: PMNode,
  ranges: readonly SelectionRange[],
  type: MarkType,
  wantToken: string | null,
): boolean {
  let sawInline = false;
  let all = true;
  for (const { $from, $to } of ranges) {
    doc.nodesBetween($from.pos, $to.pos, (node) => {
      if (!node.isInline) return true;
      sawInline = true;
      const mark = markOfType(node.marks, type);
      const has = wantToken === null ? !!mark : swatchToken(mark) === wantToken;
      if (!has) all = false;
      return false;
    });
  }
  return sawInline && all;
}

export function toggleFormat(kind: ToggleKind, token?: string): Command {
  const policy = POLICY[kind];
  return (state, dispatch) => {
    const type = state.schema.marks[policy.markName];
    if (!type) return false;
    // A swatch is meaningless without a token to apply; refuse rather than
    // insert a mark whose only attribute is empty.
    if (policy.family === 'swatch' && !token) return false;

    const attrs = policy.family === 'swatch' ? { token } : null;
    const wantToken = policy.family === 'swatch' ? (token as string) : null;
    const excludeType = policy.excludes ? state.schema.marks[policy.excludes] : undefined;

    const sel = state.selection;
    if (!markApplies(state.doc, sel.ranges, type)) return false;

    // Collapsed caret: arm the mark for the next character (sticky typing).
    if (sel instanceof TextSelection && sel.$cursor) {
      const current = state.storedMarks ?? sel.$cursor.marks();
      const active =
        policy.family === 'swatch'
          ? swatchToken(markOfType(current, type)) === wantToken
          : !!markOfType(current, type);
      if (dispatch) {
        const tr = state.tr;
        if (active) {
          tr.removeStoredMark(type);
        } else {
          tr.addStoredMark(type.create(attrs ?? undefined));
          if (excludeType) tr.removeStoredMark(excludeType);
        }
        dispatch(tr);
      }
      return true;
    }

    // Range: set unless every inline node in it already has the mark.
    const allHave = rangeAllHave(state.doc, sel.ranges, type, wantToken);
    if (dispatch) {
      const tr = state.tr;
      for (const { $from, $to } of sel.ranges) {
        if (allHave) {
          tr.removeMark($from.pos, $to.pos, type);
        } else {
          tr.addMark($from.pos, $to.pos, type.create(attrs ?? undefined));
          // Setting one script clears its partner across the whole range, the
          // way `WithSet` forces the opposite flag false on every span.
          if (excludeType) tr.removeMark($from.pos, $to.pos, excludeType);
        }
      }
      // Formatting a range is one undo step of its own, the desktop's "Format
      // Selection" operation. The collapsed-caret branch above deliberately is
      // not: it changes no document, and arming a mark mid-word should not cut
      // the typing run it is about to be typed into.
      dispatch(asOwnUndoStep(tr.scrollIntoView()));
    }
    return true;
  };
}

/**
 * Unconditionally removes a swatch mark, whatever token it carries.
 * `toggleFormat` cannot do this: an empty token is "nothing to apply" and it
 * refuses, so a colour picker's "clear"/"none" cell needs its own command
 * rather than a toggle call with no token to compare against.
 */
export function clearSwatch(kind: SwatchKind): Command {
  const policy = POLICY[kind];
  return (state, dispatch) => {
    const type = state.schema.marks[policy.markName];
    if (!type) return false;

    const sel = state.selection;
    if (sel instanceof TextSelection && sel.$cursor) {
      const current = state.storedMarks ?? sel.$cursor.marks();
      if (!markOfType(current, type)) return false;
      if (dispatch) dispatch(state.tr.removeStoredMark(type));
      return true;
    }

    let any = false;
    for (const { $from, $to } of sel.ranges) {
      state.doc.nodesBetween($from.pos, $to.pos, (node) => {
        if (!node.isInline) return true;
        if (markOfType(node.marks, type)) any = true;
        return false;
      });
    }
    if (!any) return false;
    if (dispatch) {
      let tr = state.tr;
      for (const { $from, $to } of sel.ranges) tr = tr.removeMark($from.pos, $to.pos, type);
      dispatch(asOwnUndoStep(tr.scrollIntoView()));
    }
    return true;
  };
}

/**
 * Whether a format reads as "on" for the current selection, the state a toolbar
 * button highlights by. This is the *same* decision `toggleFormat` makes about
 * whether a click would clear or set, taken from the same helpers: a collapsed
 * caret reads its stored/inherited marks, a range reads all-on/any-off, and a
 * swatch reads all-on-with-this-token. One function, so the button can never
 * disagree with what pressing it does, the readout/applier asymmetry the
 * Avalonia toolbar had to guard against by hand cannot arise here.
 *
 * A swatch needs the token it is being tested for; without one it is not "active"
 * in any specific colour, so this returns false rather than guessing.
 */
export function isFormatActive(state: EditorState, kind: ToggleKind, token?: string): boolean {
  const policy = POLICY[kind];
  const type = state.schema.marks[policy.markName];
  if (!type) return false;
  if (policy.family === 'swatch' && !token) return false;
  const wantToken = policy.family === 'swatch' ? (token as string) : null;

  const sel = state.selection;
  if (sel instanceof TextSelection && sel.$cursor) {
    const current = state.storedMarks ?? sel.$cursor.marks();
    return policy.family === 'swatch'
      ? swatchToken(markOfType(current, type)) === wantToken
      : !!markOfType(current, type);
  }
  return rangeAllHave(state.doc, sel.ranges, type, wantToken);
}

/**
 * The swatch token currently in force across the selection, or null when there
 * is none or the selection mixes tokens. This is what a colour control reads to
 * show its active swatch; `isFormatActive(state, family, token)` is the same
 * answer narrowed to one candidate. Uniformity, not "appears anywhere", so a
 * partly-coloured selection reads as mixed rather than falsely committed.
 */
export function activeSwatchToken(state: EditorState, kind: SwatchKind): string | null {
  const policy = POLICY[kind];
  const type = state.schema.marks[policy.markName];
  if (!type) return null;

  const sel = state.selection;
  if (sel instanceof TextSelection && sel.$cursor) {
    const current = state.storedMarks ?? sel.$cursor.marks();
    return swatchToken(markOfType(current, type));
  }

  let token: string | null = null;
  let uniform = true;
  let sawInline = false;
  let first = true;
  for (const { $from, $to } of sel.ranges) {
    state.doc.nodesBetween($from.pos, $to.pos, (node) => {
      if (!node.isInline) return true;
      sawInline = true;
      const t = swatchToken(markOfType(node.marks, type));
      if (first) {
        token = t;
        first = false;
      } else if (t !== token) {
        uniform = false;
      }
      return false;
    });
  }
  return sawInline && uniform ? token : null;
}
