/**
 * Replace, as one structural transaction.
 *
 * Every replace, one or all, produces a single transaction that the caller
 * dispatches through the editor's own writer. That single-transaction shape is
 * what makes a replace one undo step, one revision bump and one autosave, the
 * same guarantee the desktop got from wrapping a replace in one structural
 * change.
 *
 * Replace revalidates the exact segment before it writes. Replace-all re-runs
 * the search against the live document, so the matches it rewrites are the ones
 * actually there now, not a list captured before the last keystroke. Replace-one
 * checks that the exact text is still where the highlighted match says it is and
 * refuses if it has moved or changed, so a replace can never overwrite content
 * the user did not see highlighted.
 *
 * It does not gate on the persisted note version, and that is deliberate. The
 * editor is the single writer of the live document: a landed save moves the
 * version but persists the same bytes the editor already holds, and a version
 * conflict stops autosave with the document untouched. So the version can only
 * change without changing the live document, and the exact-segment check is the
 * precise guard, catching every local edit that a version comparison would miss.
 *
 * Text matches rewrite a document range and take the formatting of the match's
 * first character, matching the desktop's run-format behavior. A block
 * equation's LaTeX lives in an attribute, so its replace rewrites the attribute
 * through `setNodeMarkup` rather than a range.
 */

import type { EditorState, Transaction } from 'prosemirror-state';
import { asOwnUndoStep } from '../editor/history/boundaries';
import type { BlockRegistry } from '../editor/registry/build';
import { projectionOf, searchDocument, type FindMatch, type FindOptions } from './search';

export interface ReplaceAllResult {
  readonly tr: Transaction;
  readonly count: number;
}

/** A single match paired with the text it should be replaced by. */
interface Replacement extends FindMatch {
  readonly replacement: string;
}

/** Writes `replacement` into `tr` over `[from, to]`, keeping the start's marks. */
function writeTextRange(
  tr: Transaction,
  state: EditorState,
  from: number,
  to: number,
  replacement: string,
): void {
  if (replacement.length === 0) {
    tr.delete(from, to);
    return;
  }
  // `Schema.text('')` throws, so the empty case is handled above. The marks are
  // read before any step is applied, from the live document, so they reflect the
  // match's real formatting rather than a half-mutated one.
  const marks = state.doc.resolve(from).marks();
  tr.replaceWith(from, to, state.schema.text(replacement, marks));
}

/**
 * Rewrites a block equation's LaTeX, folding one or more replacements into the
 * attribute in a single `setNodeMarkup`.
 *
 * Two matches in one equation cannot be two `setNodeMarkup` calls: each would
 * recompute from the original attribute and the last would win, dropping the
 * first. They are folded into the string in descending order instead, so an
 * earlier replacement never shifts a later one's offsets.
 */
function writeEquationMatches(
  tr: Transaction,
  state: EditorState,
  blockPos: number,
  matches: readonly Replacement[],
): boolean {
  const node = state.doc.nodeAt(blockPos);
  if (!node || node.type.name !== 'equationBlock') return false;

  let latex = String(node.attrs.latex ?? '');
  const descending = [...matches].sort((a, b) => b.localRange.start - a.localRange.start);
  for (const match of descending) {
    const { start, length } = match.localRange;
    if (latex.slice(start, start + length) !== match.exactText) return false;
    latex = latex.slice(0, start) + match.replacement + latex.slice(start + length);
  }
  tr.setNodeMarkup(blockPos, undefined, { ...node.attrs, latex });
  return true;
}

/**
 * Builds the transaction that replaces the one highlighted match, or null if the
 * match no longer describes the live document.
 *
 * The revalidation is the whole point: the highlighted match's range is mapped
 * forward through every edit since the search, so it usually still points at the
 * right text, but an edit at its boundary can drift it. Checking the exact text
 * turns that drift into a refusal rather than a silent overwrite of the wrong
 * span.
 */
export function buildReplaceOne(
  state: EditorState,
  match: FindMatch,
  replacement: string,
): Transaction | null {
  const tr = state.tr;

  if (match.backing === 'attr') {
    if (!writeEquationMatches(tr, state, match.blockPos, [{ ...match, replacement }])) return null;
  } else {
    if (match.from >= match.to || match.to > state.doc.content.size) return null;
    if (state.doc.textBetween(match.from, match.to) !== match.exactText) return null;
    writeTextRange(tr, state, match.from, match.to, replacement);
  }

  if (!tr.docChanged) return null;
  return asOwnUndoStep(tr);
}

/**
 * Builds the transaction that replaces every current match, or null if there is
 * nothing to replace.
 *
 * The search is re-run here against the live document, so matches created or
 * removed since the last keystroke are accounted for. Text edits are applied in
 * descending position order so an earlier rewrite never invalidates a later
 * one's positions; equation edits are grouped per block and folded once.
 */
export function buildReplaceAll(
  state: EditorState,
  registry: BlockRegistry,
  query: string,
  options: FindOptions,
  replacement: string,
): ReplaceAllResult | null {
  const projection = projectionOf(state.doc, registry);
  const matches = searchDocument(projection, query, options, state.doc);
  if (matches.length === 0) return null;

  const tr = state.tr;

  const textMatches = matches.filter((match) => match.backing === 'text');
  const attrByBlock = new Map<number, FindMatch[]>();
  for (const match of matches) {
    if (match.backing !== 'attr') continue;
    const group = attrByBlock.get(match.blockPos) ?? [];
    group.push(match);
    attrByBlock.set(match.blockPos, group);
  }

  // Count what is actually written, not what was found, so the reported total
  // never over-states a change that a revalidation skipped.
  let count = 0;

  // Text edits descend by position: every applied edit sits above the ones still
  // to come, so their original positions stay valid without remapping.
  const descending = [...textMatches].sort((a, b) => b.from - a.from);
  for (const match of descending) {
    if (state.doc.textBetween(match.from, match.to) !== match.exactText) continue;
    writeTextRange(tr, state, match.from, match.to, replacement);
    count += 1;
  }

  // Equations are attribute writes and never shift positions, so they compose
  // with the text edits above regardless of order.
  for (const [blockPos, group] of attrByBlock) {
    if (writeEquationMatches(tr, state, blockPos, group.map((m) => ({ ...m, replacement })))) {
      count += group.length;
    }
  }

  if (!tr.docChanged) return null;
  return { tr: asOwnUndoStep(tr), count };
}
