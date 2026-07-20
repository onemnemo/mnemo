/**
 * The edit-op wire vocabulary.
 *
 * Seven ops behind one tool. The names are chosen for the model, not for us:
 * `add`, `del`, `move`, `set` are the highest-frequency verbs in pretraining
 * for this shape of operation, and renaming schema elements toward vocabulary
 * a model has actually seen is a measurable accuracy win at zero runtime cost.
 * The C# surface this replaces uses `insert`/`delete`/`replace`/`convert` plus
 * a separate `set_checked`; the rename is deliberate, not drift.
 *
 * Fields are short and flat — `at`, `to`, `md`, `find` — because every op in a
 * batch pays for its key names, and because nesting is what degrades
 * tool-calling accuracy fastest. There is deliberately no `children` on an
 * added block: nesting is two consecutive ops (`add` a container, then `add`
 * into it), which keeps the schema flat at the cost of one extra op in the rare
 * case that needs it.
 */

import type { BlockType } from '../model/types';

/**
 * Where an `add` or `move` lands relative to its anchor.
 *
 * `before`/`after`/`in` need an anchor; `start`/`end` are document-level and
 * must not have one. The C# implementation silently coerces every unrecognized
 * combination to "after the anchor" or "at the end", which turns a model's
 * mistake into a block quietly appearing somewhere it did not ask for. These
 * are validated instead.
 */
export type OpWhere = 'before' | 'after' | 'in' | 'start' | 'end';

/**
 * Marks a `fmt` op may toggle.
 *
 * Only the marks that are genuinely a boolean. `link` carries an href, so it
 * has no meaningful `on: true` without a second field and is set through `md`
 * as `[text](url)` instead. The two colour marks are excluded for the same
 * reason, and `noAutoLink` because it is editor bookkeeping rather than
 * formatting a model should reason about.
 */
export const fmtMarks = {
  b: 'strong',
  i: 'em',
  u: 'underline',
  s: 'strike',
  code: 'codeMark',
  hl: 'highlight',
  sub: 'sub',
  sup: 'sup',
} as const;

export type FmtMark = keyof typeof fmtMarks;

/** A block an `add` op creates. `t` is a two-character type code. */
export interface NewBlockSpec {
  readonly t?: string;
  readonly md?: string;
  /** Initial checked state, for a `td` block. */
  readonly checked?: boolean;
  /** Language, for a `c` block. */
  readonly lang?: string;
}

/** Replaces a block's entire inline content. */
export interface SetOp {
  readonly op: 'set';
  readonly id: string;
  readonly md: string;
}

/** Replaces found text inside one block. */
export interface EditOp {
  readonly op: 'edit';
  readonly id: string;
  readonly find: string;
  readonly md: string;
}

/** Applies or removes a mark over found text. */
export interface FmtOp {
  readonly op: 'fmt';
  readonly id: string;
  readonly find: string;
  readonly mark: string;
  readonly on: boolean;
}

/** Inserts blocks. */
export interface AddOp {
  readonly op: 'add';
  readonly at?: string;
  readonly where?: OpWhere;
  readonly blocks: readonly NewBlockSpec[];
}

/** Deletes blocks, and with them their children. */
export interface DelOp {
  readonly op: 'del';
  readonly ids: readonly string[];
}

/** Reorders one block. */
export interface MoveOp {
  readonly op: 'move';
  readonly id: string;
  readonly at: string;
  readonly where?: OpWhere;
}

/**
 * Converts a block's type.
 *
 * Checking a checkbox is `{op:'type', to:'td', checked:true}` rather than its
 * own op, which makes it idempotent: the same call twice leaves the same state,
 * where a toggle would not.
 */
export interface TypeOp {
  readonly op: 'type';
  readonly id: string;
  readonly to: string;
  readonly checked?: boolean;
  readonly lang?: string;
}

export type NoteOp = SetOp | EditOp | FmtOp | AddOp | DelOp | MoveOp | TypeOp;

/** The envelope a batch arrives in. */
export interface NoteEditRequest {
  /** Note sid. */
  readonly note: string;
  /** The version the batch was composed against. */
  readonly ver: number;
  readonly ops: readonly NoteOp[];
}

/**
 * What one op did, for rendering a preview.
 *
 * Deliberately about blocks rather than characters: the approval UI shows the
 * user which blocks an agent touched, and a character-level diff of a rich
 * document is both harder to produce and harder to read.
 */
export interface DiffEntry {
  readonly kind: 'add' | 'del' | 'update' | 'move';
  readonly sid: string;
  readonly type: BlockType;
  /** Block text before the op; absent for an add. */
  readonly before?: string;
  /** Block text after the op; absent for a delete. */
  readonly after?: string;
}
