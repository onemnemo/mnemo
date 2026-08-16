/**
 * The operation compiler: edit ops in, one ProseMirror transaction out.
 *
 * **ProseMirror is the only writer.** The C# `NotesToolService` mutates
 * `List<Block>` directly, and keeping that path alongside this one would mean
 * two edit engines with different validation, where the C# one happily
 * produces documents the schema rejects (a code block carrying marks, a column
 * cell holding another two-column block, a block converted to `Equation` that
 * kept its old text spans and never got an equation payload). Those are not
 * hypotheticals; they are all reachable in the current implementation. This
 * compiler exists so that every edit, whoever asks for it, goes through the
 * same schema.
 *
 * Everything here is pure: no `EditorView`, no React, no network, no clock. The
 * caller applies the transaction, or does not. Compiling twice against the same
 * state gives the same answer, which is what lets the safety gate re-resolve a
 * batch at commit time and compare it against what the user approved.
 *
 * **All-or-nothing.** Every op accumulates into one transaction, so a batch is
 * one undo entry, one preview and one validation boundary. The first op that
 * fails aborts the batch and nothing is dispatched, matching the C# service,
 * which applies ops to a clone and simply drops it on failure.
 */

import type { Schema } from 'prosemirror-model';
import { Fragment, type Node as PMNode } from 'prosemirror-model';
import type { EditorState, Transaction } from 'prosemirror-state';
import type { BlockRegistry } from '../editor/registry/build';
import type { DocumentMapper } from '../editor/mapper/document';
import { walkBlocks, type BlockEntry } from '../editor/projection/document';
import type { BlockSchema } from '../editor/registry/types';
import type { InlineMapper } from '../editor/mapper/inline';
import { createBlock } from '../model/factory';
import type { Block, BlockPayload, BlockType, InlineSpan } from '../model/types';
import { resolveRef, type ResolveError } from './resolve';
import { typeByCode } from './outline';
import {
  fmtMarks,
  type AddOp,
  type DelOp,
  type DiffEntry,
  type EditOp,
  type FmtMark,
  type FmtOp,
  type MoveOp,
  type NewBlockSpec,
  type NoteOp,
  type SetOp,
  type TypeOp,
} from './types';

export interface CompileError {
  readonly code: 'validation_error' | 'not_found' | 'conflict';
  /** Formatted as `op[i] (name): detail`, matching the C# failure shape. */
  readonly message: string;
  /** Index into the submitted ops array. */
  readonly opIndex: number;
  readonly candidates?: readonly string[];
}

/**
 * A discriminated union rather than a `{tr, diff, errors}` triple. A batch is
 * all-or-nothing, so there is never a transaction *and* an
 * error, and never more than one error, an array of at most one would invite
 * callers to write partial-application logic for a case that cannot occur.
 */
export type CompileResult =
  | { readonly ok: true; readonly tr: Transaction; readonly diff: readonly DiffEntry[] }
  | { readonly ok: false; readonly error: CompileError };

export interface CompileDeps {
  readonly schema: Schema;
  readonly registry: BlockRegistry;
  readonly mapper: DocumentMapper;
  readonly inline: InlineMapper;
  /**
   * Parses an op's `md` field into inline spans.
   *
   * Required, with no default on purpose. A fallback that treated `md` as plain
   * text would turn `**bold**` into four literal asterisks, a wrong-but-valid
   * result, which is precisely the failure mode that is hardest for a model to
   * notice and recover from.
   */
  parseInline(md: string): readonly InlineSpan[];
}

export function compileOps(
  state: EditorState,
  ops: readonly NoteOp[],
  deps: CompileDeps,
): CompileResult {
  if (ops.length === 0) {
    return {
      ok: false,
      error: { code: 'validation_error', message: 'ops is required and must be non-empty.', opIndex: 0 },
    };
  }

  const tr = state.tr;
  const diff: DiffEntry[] = [];

  for (const [index, op] of ops.entries()) {
    const failure = applyOp(tr, op, diff, deps);
    if (failure) {
      return {
        ok: false,
        error: {
          ...failure,
          opIndex: index,
          message: `op[${String(index)}] (${op.op}): ${failure.message}`,
        },
      };
    }
  }

  return { ok: true, tr, diff };
}

type OpFailure = Omit<CompileError, 'opIndex'>;

function fail(code: OpFailure['code'], message: string): OpFailure {
  return { code, message };
}

function fromResolve(error: ResolveError): OpFailure {
  return { code: error.code, message: error.message, candidates: error.candidates };
}

function applyOp(
  tr: Transaction,
  op: NoteOp,
  diff: DiffEntry[],
  deps: CompileDeps,
): OpFailure | null {
  switch (op.op) {
    case 'set':
      return applySet(tr, op, diff, deps);
    case 'edit':
      return applyEdit(tr, op, diff, deps);
    case 'fmt':
      return applyFmt(tr, op, diff, deps);
    case 'add':
      return applyAdd(tr, op, diff, deps);
    case 'del':
      return applyDel(tr, op, diff, deps);
    case 'move':
      return applyMove(tr, op, diff, deps);
    case 'type':
      return applyType(tr, op, diff, deps);
    default:
      // Unreachable through the typed surface, but a hand-built batch or a
      // model emitting an op name we retired arrives here.
      return fail(
        'validation_error',
        `unknown op "${String((op as { op: string }).op)}". Use set, edit, fmt, add, del, move, or type.`,
      );
  }
}

/**
 * Re-reads the document from the transaction, so every op resolves against the
 * result of the ones before it.
 *
 * Rebuilding the index per op is O(ops x blocks). That is the right trade at a
 * batch size of ten: mapping stale positions forward through the accumulated
 * steps is the standard source of off-by-one corruption in this kind of code,
 * and here the positions simply cannot be stale.
 */
function indexOf(tr: Transaction, deps: CompileDeps): BlockEntry[] {
  return walkBlocks(tr.doc, deps.registry);
}

function locate(
  tr: Transaction,
  ref: string | undefined,
  deps: CompileDeps,
): { entry: BlockEntry } | { failure: OpFailure } {
  const result = resolveRef(indexOf(tr, deps), ref);
  return result.ok ? { entry: result.entry } : { failure: fromResolve(result.error) };
}

/** The block's line node, its absolute position, and its content range. */
interface LineRange {
  readonly line: PMNode;
  readonly from: number;
  readonly to: number;
  readonly isCode: boolean;
}

function lineRangeOf(entry: BlockEntry): LineRange | null {
  const line = entry.node.firstChild;
  if (!line || (line.type.name !== 'line' && line.type.name !== 'codeLine')) return null;
  // The block opens at `pos`, its line opens at `pos + 1`, and the line's
  // content begins at `pos + 2`.
  const from = entry.pos + 2;
  return { line, from, to: from + line.content.size, isCode: line.type.name === 'codeLine' };
}

function inlineContent(
  md: string,
  isCode: boolean,
  deps: CompileDeps,
): PMNode[] {
  return deps.inline.toInline(deps.parseInline(md), deps.schema as unknown as BlockSchema, {
    withMarks: !isCode,
  });
}

function textOf(entry: BlockEntry): string {
  return entry.module.project.plainText(entry.node);
}

// ---------------------------------------------------------------------------
// set
// ---------------------------------------------------------------------------

function applySet(tr: Transaction, op: SetOp, diff: DiffEntry[], deps: CompileDeps): OpFailure | null {
  const found = locate(tr, op.id, deps);
  if ('failure' in found) return found.failure;

  const range = lineRangeOf(found.entry);
  if (!range) return fail('validation_error', 'block has no editable line.');

  const before = textOf(found.entry);
  tr.replaceWith(range.from, range.to, Fragment.fromArray(inlineContent(op.md ?? '', range.isCode, deps)));

  diff.push({
    kind: 'update',
    sid: found.entry.sid,
    type: found.entry.type,
    before,
    after: op.md ?? '',
  });
  return null;
}

// ---------------------------------------------------------------------------
// edit and fmt, both resolve a `find` to a range first
// ---------------------------------------------------------------------------

interface FoundRange {
  readonly entry: BlockEntry;
  readonly from: number;
  readonly to: number;
}

/**
 * Resolves `find` to exactly one range inside one block.
 *
 * Both zero matches and several matches are rejections rather than a
 * best-effort pick. A model that meant the second occurrence and silently got
 * the first has no way to detect the mistake, whereas an ambiguity error is
 * something it can act on by quoting more surrounding text.
 */
function findRange(
  tr: Transaction,
  id: string,
  find: string,
  deps: CompileDeps,
): FoundRange | OpFailure {
  const found = locate(tr, id, deps);
  if ('failure' in found) return found.failure;
  if (!find || find.length === 0) return fail('validation_error', 'find is required.');

  const entry = found.entry;
  const text = textOf(entry);
  const first = text.indexOf(find);
  if (first < 0) {
    return fail('not_found', `no match for "${find}" in block ${entry.sid}.`);
  }
  if (text.indexOf(find, first + 1) >= 0) {
    const count = text.split(find).length - 1;
    return fail(
      'validation_error',
      `"${find}" matches ${String(count)} times in block ${entry.sid}; quote more surrounding text.`,
    );
  }

  // Text offsets and PM positions are not related by addition, an inline atom
  // projects as its whole LaTeX source but occupies one position, so both ends
  // go through the block's own projection.
  return {
    entry,
    from: entry.pos + entry.module.project.positionOf(entry.node, first),
    to: entry.pos + entry.module.project.positionOf(entry.node, first + find.length),
  };
}

function applyEdit(tr: Transaction, op: EditOp, diff: DiffEntry[], deps: CompileDeps): OpFailure | null {
  const range = findRange(tr, op.id, op.find, deps);
  if (!('entry' in range)) return range;

  const before = textOf(range.entry);
  const isCode = range.entry.node.firstChild?.type.name === 'codeLine';
  tr.replaceWith(range.from, range.to, Fragment.fromArray(inlineContent(op.md ?? '', isCode, deps)));

  diff.push({
    kind: 'update',
    sid: range.entry.sid,
    type: range.entry.type,
    before,
    after: before.replace(op.find, op.md ?? ''),
  });
  return null;
}

function applyFmt(tr: Transaction, op: FmtOp, diff: DiffEntry[], deps: CompileDeps): OpFailure | null {
  const markName = fmtMarks[op.mark as FmtMark] as string | undefined;
  if (!markName) {
    return fail(
      'validation_error',
      `unknown mark "${op.mark}". Use ${Object.keys(fmtMarks).join(', ')}.`,
    );
  }

  const range = findRange(tr, op.id, op.find, deps);
  if (!('entry' in range)) return range;

  if (range.entry.node.firstChild?.type.name === 'codeLine') {
    // Not a silent no-op: `codeLine` forbids marks structurally, so the step
    // would be dropped and the model would believe the formatting applied.
    return fail('validation_error', `block ${range.entry.sid} is a source block and cannot carry marks.`);
  }

  const markType = deps.schema.marks[markName];
  const text = textOf(range.entry);
  if (op.on) tr.addMark(range.from, range.to, markType.create());
  else tr.removeMark(range.from, range.to, markType);

  diff.push({ kind: 'update', sid: range.entry.sid, type: range.entry.type, before: text, after: text });
  return null;
}

// ---------------------------------------------------------------------------
// add
// ---------------------------------------------------------------------------

function applyAdd(tr: Transaction, op: AddOp, diff: DiffEntry[], deps: CompileDeps): OpFailure | null {
  if (!op.blocks || op.blocks.length === 0) {
    return fail('validation_error', 'add has no content. Provide blocks[].');
  }

  const where = op.where ?? (op.at ? 'after' : 'end');
  const anchored = where === 'before' || where === 'after' || where === 'in';

  // The C# service coerces every unrecognized anchor/position combination into
  // "after the anchor" or "at the end". That turns a model's mistake into a
  // block quietly appearing where it did not ask for, which is exactly the
  // silent-wrong-result the rejection paths exist to avoid.
  if (anchored && !op.at) {
    return fail('validation_error', `where "${where}" needs an anchor. Provide at.`);
  }
  if (!anchored && op.at) {
    return fail('validation_error', `where "${where}" is document-level and takes no anchor.`);
  }

  const taken = new Set(indexOf(tr, deps).map((b) => b.sid));
  const nodes: PMNode[] = [];
  for (const spec of op.blocks) {
    const built = buildBlock(spec, taken, deps);
    if ('failure' in built) return built.failure;
    taken.add(built.block.sid);
    nodes.push(deps.mapper.toNode(built.block));
    diff.push({
      kind: 'add',
      sid: built.block.sid,
      type: built.block.type,
      after: spec.md ?? '',
    });
  }

  const fragment = Fragment.fromArray(nodes);
  const at = insertionPoint(tr, op, where, fragment, deps);
  if (typeof at !== 'number') return at;

  tr.insert(at, fragment);
  return null;
}

function insertionPoint(
  tr: Transaction,
  op: AddOp,
  where: string,
  fragment: Fragment,
  deps: CompileDeps,
): number | OpFailure {
  if (where === 'start') return 0;
  if (where === 'end') return tr.doc.content.size;

  const found = locate(tr, op.at, deps);
  if ('failure' in found) return found.failure;
  const entry = found.entry;

  if (where === 'before') return entry.pos;
  if (where === 'after') return entry.pos + entry.node.nodeSize;

  // `in` appends as the anchor's last block child, just inside its closing
  // token. Whether that is legal is a question only the content expression can
  // answer, a two-column block is `line columnGroup columnGroup` and takes no
  // ordinary block, while most types end in `block*` and take anything.
  if (!canAppend(entry.node, fragment)) {
    return fail('validation_error', `block ${entry.sid} cannot contain these blocks.`);
  }
  return entry.pos + entry.node.nodeSize - 1;
}

/** Whether `fragment` may be appended to `parent`'s existing content. */
function canAppend(parent: PMNode, fragment: Fragment): boolean {
  return parent.contentMatchAt(parent.childCount).matchFragment(fragment) !== null;
}

function buildBlock(
  spec: NewBlockSpec,
  taken: ReadonlySet<string>,
  deps: CompileDeps,
): { block: Block } | { failure: OpFailure } {
  const code = (spec.t ?? 'p').trim();
  const type = typeByCode.get(code);
  if (!type) {
    return {
      failure: fail('validation_error', `unknown type "${code}". Use one of ${[...typeByCode.keys()].join(', ')}.`),
    };
  }
  if (type === 'TwoColumn' || type === 'ColumnGroup') {
    // A two-column block is only valid with exactly two column cells, and the
    // op vocabulary has no `children` field to supply them. Building one here
    // would produce a document the schema refuses, failing the whole batch with
    // a confusing message instead of this one.
    return {
      failure: fail(
        'validation_error',
        `"${code}" cannot be created directly; add its container and its cells as separate ops.`,
      ),
    };
  }

  const payload = payloadFor(type, spec);
  return {
    block: createBlock(taken, {
      type,
      payload,
      spans: spec.md ? [...deps.parseInline(spec.md)] : undefined,
    }),
  };
}

function payloadFor(type: BlockType, spec: NewBlockSpec): BlockPayload | undefined {
  switch (type) {
    case 'Checklist':
      return { kind: 'checklist', checked: spec.checked ?? false };
    case 'Code':
      // The C# default when a language is omitted; kept so a code block created
      // through either surface highlights the same way.
      return { kind: 'code', language: spec.lang ?? 'csharp', source: spec.md ?? '' };
    case 'Equation':
      return { kind: 'equation', latex: spec.md ?? '' };
    case 'Sketch':
      return { kind: 'sketch', width: 0, align: 'left' };
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// del
// ---------------------------------------------------------------------------

function applyDel(tr: Transaction, op: DelOp, diff: DiffEntry[], deps: CompileDeps): OpFailure | null {
  const ids = op.ids ?? [];
  if (ids.length === 0) return fail('validation_error', 'del requires ids.');

  // Each id resolves against the document as it stands after the previous
  // deletion, so index shifts take care of themselves. Deleting a block removes
  // its children with it, so naming both a parent and its child in one op makes
  // the second reference genuinely absent, reported rather than ignored.
  for (const id of ids) {
    const found = locate(tr, id, deps);
    if ('failure' in found) return found.failure;
    const entry = found.entry;
    diff.push({ kind: 'del', sid: entry.sid, type: entry.type, before: textOf(entry) });
    tr.delete(entry.pos, entry.pos + entry.node.nodeSize);
  }
  return null;
}

// ---------------------------------------------------------------------------
// move
// ---------------------------------------------------------------------------

function applyMove(tr: Transaction, op: MoveOp, diff: DiffEntry[], deps: CompileDeps): OpFailure | null {
  const index = indexOf(tr, deps);

  const target = resolveRef(index, op.id);
  if (!target.ok) return fromResolve(target.error);
  const anchorRef = resolveRef(index, op.at);
  if (!anchorRef.ok) return fromResolve(anchorRef.error);

  const moving = target.entry;
  const anchor = anchorRef.entry;

  // Both are resolved before anything moves. The C# implementation removes the
  // block first and only then looks up the anchor, so moving a block relative
  // to itself reports `not_found` for an id that was plainly there, a
  // confusing error for what is really an unsatisfiable request.
  if (moving.sid === anchor.sid) {
    return fail('validation_error', `block ${moving.sid} cannot move relative to itself.`);
  }

  const movingEnd = moving.pos + moving.node.nodeSize;
  if (anchor.pos > moving.pos && anchor.pos < movingEnd) {
    // Reparenting a block under its own descendant would detach the subtree
    // from the document entirely.
    return fail('validation_error', `block ${moving.sid} cannot move inside itself.`);
  }

  const where = op.where ?? 'after';
  if (where === 'start' || where === 'end') {
    return fail('validation_error', `move needs where before, after or in.`);
  }
  if (where === 'in' && !canAppend(anchor.node, Fragment.from(moving.node))) {
    return fail('validation_error', `block ${anchor.sid} cannot contain block ${moving.sid}.`);
  }

  const node = moving.node;
  tr.delete(moving.pos, movingEnd);

  // The anchor's position is only valid in the pre-deletion document, so it is
  // mapped through the step that removed the block rather than recomputed.
  const mapped = tr.mapping.map(anchor.pos, -1);
  const anchorSize = anchor.node.nodeSize;
  const at =
    where === 'before' ? mapped : where === 'in' ? mapped + anchorSize - 1 : mapped + anchorSize;

  tr.insert(at, node);
  diff.push({ kind: 'move', sid: moving.sid, type: moving.type, before: textOf(moving), after: textOf(moving) });
  return null;
}

// ---------------------------------------------------------------------------
// type
// ---------------------------------------------------------------------------

function applyType(tr: Transaction, op: TypeOp, diff: DiffEntry[], deps: CompileDeps): OpFailure | null {
  const code = (op.to ?? '').trim();
  const target = typeByCode.get(code);
  if (!target) {
    return fail('validation_error', `unknown type "${code}". Use one of ${[...typeByCode.keys()].join(', ')}.`);
  }
  if (target === 'TwoColumn' || target === 'ColumnGroup') {
    return fail('validation_error', `cannot convert a block to "${code}".`);
  }

  const found = locate(tr, op.id, deps);
  if ('failure' in found) return found.failure;
  const entry = found.entry;

  // Round-tripping through the model layer is what makes conversion total. The
  // C# `convert` only fixes up the checklist payload and leaves everything else
  // alone, so converting a text block to `Equation` there produces a block with
  // no equation payload and stale spans. Rebuilding through the owning module
  // means the result is whatever that type's own serializer says it should be,
  // or the schema refuses it and the batch fails loudly.
  const before = deps.mapper.fromNode(entry.node);
  const converted: Block = {
    ...before,
    type: target,
    payload: convertedPayload(target, before, op),
  };

  let node: PMNode;
  try {
    node = deps.mapper.toNode(converted);
  } catch (error) {
    return fail(
      'validation_error',
      `cannot convert block ${entry.sid} to "${code}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  tr.replaceWith(entry.pos, entry.pos + entry.node.nodeSize, node);
  diff.push({
    kind: 'update',
    sid: entry.sid,
    type: target,
    before: textOf(entry),
    after: textOf(entry),
  });
  return null;
}

function convertedPayload(target: BlockType, before: Block, op: TypeOp): BlockPayload {
  switch (target) {
    case 'Checklist':
      // Explicit `checked` wins; otherwise a block that was already a checklist
      // keeps its state, so re-issuing the same op is a no-op rather than a
      // silent uncheck.
      return {
        kind: 'checklist',
        checked: op.checked ?? (before.payload.kind === 'checklist' ? before.payload.checked : false),
      };
    case 'Code':
      return {
        kind: 'code',
        language: op.lang ?? (before.payload.kind === 'code' ? before.payload.language : 'csharp'),
        source: before.spans.map((s) => (s.kind === 'text' ? s.text : '')).join(''),
      };
    case 'Equation':
      return {
        kind: 'equation',
        latex:
          before.payload.kind === 'equation'
            ? before.payload.latex
            : before.spans.map((s) => (s.kind === 'text' ? s.text : '')).join(''),
      };
    case 'Image':
      // A converted block has no asset, so it becomes an image with an empty
      // path, the same shape the wire reader produces for one, rather than a
      // payload with fields missing.
      return before.payload.kind === 'image'
        ? before.payload
        : { kind: 'image', path: '', alt: '', width: 0, align: 'left' };
    case 'Page':
      return before.payload.kind === 'page' ? before.payload : { kind: 'page', referenceNoteId: '' };
    case 'Sketch':
      return before.payload.kind === 'sketch'
        ? before.payload
        : { kind: 'sketch', width: 0, align: 'left' };
    default:
      // Everything else carries no payload, so a stale one is dropped rather
      // than left to be silently discarded by the schema on the next save.
      return { kind: 'empty' };
  }
}
