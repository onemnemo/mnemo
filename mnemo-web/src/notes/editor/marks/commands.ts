/**
 * The custom inline-format toggle command.
 *
 * Deliberately NOT ProseMirror's stock `toggleMark`. Two behaviours the Avalonia
 * editor guarantees are ones `toggleMark` gets wrong, so this reproduces
 * `InlineSpanFormatApplier.Apply` + `TextStyle.WithToggle` instead:
 *
 *  - **Decision rule.** `toggleMark` strips a mark that appears *anywhere* in the
 *    selection. Mnemo sets the mark unless *every* span in the range already has
 *    it — so formatting a half-formatted selection finishes the job rather than
 *    clearing the part that was already formatted. That is the behaviour the
 *    corpus was authored under.
 *
 *  - **Swatch replace.** A swatch mark carries a design token. Toggling
 *    `swatch5` over a run already coloured `swatch3` must *replace* the token,
 *    not clear the colour — `toggleMark` is attr-blind and would clear. Here the
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

import { TextSelection, type Command, type SelectionRange } from 'prosemirror-state';
import type { Mark, MarkType, Node as PMNode } from 'prosemirror-model';

type FlagKind = 'bold' | 'italic' | 'underline' | 'strikethrough' | 'code' | 'highlight';
type SwatchKind = 'backgroundColor' | 'foregroundColor';
type ScriptKind = 'subscript' | 'superscript';

/** The inline formats a plain toggle applies. Link is set via a URL, not toggled. */
export type ToggleKind = FlagKind | SwatchKind | ScriptKind;

interface Policy {
  readonly markName: string;
  readonly family: 'flag' | 'swatch' | 'script';
  /** The mark this one clears when it is set — sub/sup only. */
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
 * Whether the mark can apply anywhere in the selection at all — false inside a
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
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}
