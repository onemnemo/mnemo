/**
 * What the editor fuzzer asserts after every operation.
 *
 * Each check answers one question a user would notice the answer to: does the
 * document still satisfy its own schema, does every block still have the short
 * id the AI addresses it by, would saving and reopening the note give back what
 * is on screen, and is the caret somewhere that exists.
 *
 * A failure carries a grouping key as well as a message, so a hundred seeds
 * tripping over one root cause report as one class rather than as a hundred
 * findings.
 */

import type { Node as PMNode } from 'prosemirror-model';
import { Selection, type EditorState } from 'prosemirror-state';
import type { BlockRegistry } from './registry/build';
import type { DocumentMapper } from './mapper/document';
import { walkBlocks } from './projection/document';
import { isWellFormedBlockSid } from '../model/sid';
import { parseBlocks, serializeBlocks } from '../model/wire';

export interface Failure {
  /** Which invariant broke. */
  readonly check: string;
  /** Stable grouping key; identical root causes share one. */
  readonly klass: string;
  readonly detail: string;
}

/** Strips the numbers out of a message so two instances of one bug group together. */
function normalize(text: string): string {
  return text.replace(/\d+/g, 'N').slice(0, 160);
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

function checkDoc(doc: PMNode): Failure[] {
  try {
    doc.check();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [{ check: 'doc.check', klass: `doc.check:${normalize(message)}`, detail: message }];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Short ids
// ---------------------------------------------------------------------------

function checkSids(doc: PMNode, registry: BlockRegistry): Failure[] {
  const failures: Failure[] = [];
  const seen = new Map<string, number>();
  for (const entry of walkBlocks(doc, registry)) {
    const sid = entry.sid;
    if (sid === '') {
      failures.push({
        check: 'sid',
        klass: `sid:missing:${entry.node.type.name}`,
        detail: `a ${entry.node.type.name} at ${String(entry.pos)} has no sid`,
      });
      continue;
    }
    if (!isWellFormedBlockSid(sid)) {
      failures.push({
        check: 'sid',
        klass: `sid:malformed:${entry.node.type.name}`,
        detail: `a ${entry.node.type.name} at ${String(entry.pos)} carries the sid ${JSON.stringify(sid)}`,
      });
    }
    const previous = seen.get(sid);
    if (previous !== undefined) {
      failures.push({
        check: 'sid',
        klass: `sid:duplicate:${entry.node.type.name}`,
        detail: `sid ${sid} is on two blocks, at ${String(previous)} and ${String(entry.pos)}`,
      });
    }
    seen.set(sid, entry.pos);
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

/**
 * Nodes that are scenery for one owner and mean nothing anywhere else.
 *
 * The schema cannot state this on its own: every block's content is
 * `line block*`, so a column cell is a legal child of a paragraph as far as
 * ProseMirror is concerned, and `doc.check()` passes over one. The product
 * never authors that shape, and a cell outside its two column is not
 * selectable (`selectableEntries` excludes containers) and not addressable by
 * the chrome, so its contents are stranded.
 */
const REQUIRED_PARENTS: Readonly<Record<string, readonly string[]>> = {
  columnGroup: ['twoColumn'],
  tableRow: ['table'],
  tableCell: ['tableRow'],
};

function checkStructure(doc: PMNode): Failure[] {
  const failures: Failure[] = [];
  const walk = (node: PMNode, parentName: string, pos: number): void => {
    node.content.forEach((child, offset) => {
      const allowed = REQUIRED_PARENTS[child.type.name];
      if (allowed && !allowed.includes(node.type.name)) {
        failures.push({
          check: 'structure',
          klass: `structure:${child.type.name}-inside-${node.type.name}`,
          detail: `a ${child.type.name} at ${String(pos + offset + 1)} sits inside a ${parentName}, which cannot own one`,
        });
      }
      walk(child, child.type.name, pos + offset + 1);
    });
  };
  walk(doc, 'doc', -1);
  return failures;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function checkSelection(state: EditorState): Failure[] {
  const selection = state.selection;
  const size = state.doc.content.size;
  if (selection.from < 0 || selection.to > size || selection.from > selection.to) {
    return [
      {
        check: 'selection',
        klass: 'selection:out-of-range',
        detail: `selection ${String(selection.from)}..${String(selection.to)} against a document of ${String(size)}`,
      },
    ];
  }
  try {
    Selection.fromJSON(state.doc, selection.toJSON() as Parameters<typeof Selection.fromJSON>[1]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      {
        check: 'selection',
        klass: `selection:unresolvable:${normalize(message)}`,
        detail: message,
      },
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// The save-and-reopen round trip
// ---------------------------------------------------------------------------

/** An array index is not part of the identity of a difference; two seeds hitting it should group. */
function normalizePath(path: string): string {
  return path.replace(/\[\d+\]/g, '[]');
}

function diffJson(a: unknown, b: unknown, path: string, out: string[]): void {
  if (out.length >= 4) return;
  if (a === b) return;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      out.push(`${path}: ${String(a.length)} entries before, ${String(b.length)} after`);
      return;
    }
    for (let i = 0; i < a.length; i += 1) diffJson(a[i], b[i], `${path}[${String(i)}]`, out);
    return;
  }
  const aObject = typeof a === 'object' && a !== null && !Array.isArray(a);
  const bObject = typeof b === 'object' && b !== null && !Array.isArray(b);
  if (aObject && bObject) {
    const record = a as Record<string, unknown>;
    // The node type goes into the path, so a difference reads as the block it
    // is in rather than as an index nothing can be looked up by.
    const type = record.type;
    const base =
      typeof type === 'string' && (b as Record<string, unknown>).type === type
        ? `${path}{${type}}`
        : path;
    const keys = new Set([...Object.keys(record), ...Object.keys(b as Record<string, unknown>)]);
    for (const key of [...keys].sort()) {
      diffJson(record[key], (b as Record<string, unknown>)[key], `${base}.${key}`, out);
    }
    return;
  }
  out.push(`${path}: ${JSON.stringify(a) ?? 'undefined'} became ${JSON.stringify(b) ?? 'undefined'}`);
}

/**
 * Attributes the save path recomputes from the node rather than storing.
 *
 * An image's `alt` is written from its caption line on the way out, and a
 * table's flag arrays are padded and trimmed to the real row and column counts.
 * The document held in the editor therefore keeps whatever these said when the
 * note was loaded, and the document that comes back from a save carries the
 * recomputed values. Nothing reads the stale copy (the image view takes its alt
 * from the line, and every table reader goes through `headerRowsOf` and its
 * neighbours), so a difference confined to these is normalization, not loss.
 * They are reported separately rather than ignored.
 */
const DERIVED_ATTRS: Readonly<Record<string, readonly string[]>> = {
  image: ['alt'],
  table: ['headerRows', 'headerColumns', 'columnWidths'],
};

function stripDerived(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripDerived);
  if (typeof value !== 'object' || value === null) return value;
  const node = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(node)) out[key] = stripDerived(entry);
  const derived = typeof node.type === 'string' ? DERIVED_ATTRS[node.type] : undefined;
  const attrs = out.attrs;
  if (derived && typeof attrs === 'object' && attrs !== null) {
    const copy = { ...(attrs as Record<string, unknown>) };
    for (const key of derived) delete copy[key];
    out.attrs = copy;
  }
  return out;
}

/** The first few places two documents disagree, for a failure message. */
export function describeDifference(before: unknown, after: unknown): string {
  const differences: string[] = [];
  diffJson(before, after, 'doc', differences);
  return differences.join(' | ');
}

/**
 * Saves the document the way the app saves it and loads it back the way the app
 * loads it. Anything that differs is content the user would lose by closing the
 * note.
 */
export function checkRoundTrip(doc: PMNode, mapper: DocumentMapper): Failure[] {
  let reloaded: PMNode;
  try {
    const blocks = mapper.fromDoc(doc);
    const wire: unknown = JSON.parse(JSON.stringify(serializeBlocks(blocks)));
    const result = mapper.toDoc(parseBlocks(wire));
    if (!result.ok) {
      return [
        {
          check: 'roundTrip',
          klass: `roundTrip:quarantined:${normalize(result.reason.kind)}`,
          detail: `reopening the saved note quarantines it: ${result.reason.message}`,
        },
      ];
    }
    reloaded = result.doc;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      {
        check: 'roundTrip',
        klass: `roundTrip:threw:${normalize(message)}`,
        detail: message,
      },
    ];
  }

  const before: unknown = doc.toJSON();
  const after: unknown = reloaded.toJSON();
  if (JSON.stringify(before) === JSON.stringify(after)) return [];

  const differences: string[] = [];
  diffJson(stripDerived(before), stripDerived(after), 'doc', differences);
  if (differences.length === 0) {
    const derived: string[] = [];
    diffJson(before, after, 'doc', derived);
    return [
      {
        check: 'roundTripDerived',
        klass: `roundTripDerived:${normalizePath((derived[0] ?? '').split(':')[0])}`,
        detail: derived.join(' | '),
      },
    ];
  }
  const first = differences[0];
  return [
    {
      check: 'roundTrip',
      klass: `roundTrip:${normalizePath(first.split(':')[0])}`,
      detail: differences.join(' | '),
    },
  ];
}

// ---------------------------------------------------------------------------
// The whole suite
// ---------------------------------------------------------------------------

export function runChecks(
  state: EditorState,
  registry: BlockRegistry,
  mapper: DocumentMapper,
): Failure[] {
  const doc = state.doc;
  const schema = checkDoc(doc);
  // Everything downstream reads a document PM has already rejected, so their
  // messages would be noise about a failure already reported.
  if (schema.length > 0) return schema;
  return [
    ...checkStructure(doc),
    ...checkSids(doc, registry),
    ...checkSelection(state),
    ...checkRoundTrip(doc, mapper),
  ];
}
