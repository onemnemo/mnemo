/**
 * LOCAL GATE — inert unless pointed at a database, so it never runs in CI.
 *
 * Runs the production mapper over a read-only copy of the real profile
 * database. Set MNEMO_CORPUS_DB to the copy's path; without it every case skips.
 *
 * Worth keeping even though it cannot run unattended: it is the only check that
 * exercises shapes nobody thought to write a fixture for. It is also not
 * sufficient on its own — real notes are already canonical, so a mapper bug that
 * only bites non-canonical data passes here. Both kinds of test have to exist.
 */

import { describe, expect, it } from 'vitest';
import { Node as PMNode } from 'prosemirror-model';
import { createEditorSchema } from '../schema';
import { createDocumentMapper } from './document';
import { parseBlock, serializeBlock } from '../../model/wire';
import type { Block } from '../../model/types';

const dbPath = process.env.MNEMO_CORPUS_DB;

// Imported only when the gate is actually running. `node:sqlite` prints an
// experimental warning on load, and this file is otherwise inert — no reason to
// put that on every unrelated test run forever.
const sqlite = dbPath ? await import('node:sqlite') : null;

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

const wireBytes = (blocks: readonly Block[]) => canonical(blocks.map(serializeBlock));

const { schema, registry } = createEditorSchema();
const mapper = createDocumentMapper(schema, registry);

function cycle(blocks: readonly Block[]): Block[] {
  const result = mapper.toDoc(blocks);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  result.doc.check();
  const restored = PMNode.fromJSON(
    schema,
    result.doc.toJSON() as Parameters<typeof PMNode.fromJSON>[1],
  );
  restored.check();
  return mapper.fromDoc(restored);
}

interface CorpusNote {
  readonly key: string;
  readonly blocks: readonly Block[];
}

function loadCorpus(path: string): CorpusNote[] {
  if (!sqlite) return [];
  // Read-only: this points at a copy of a real profile, and the gate must never
  // be the reason the user's database changes.
  const db = new sqlite.DatabaseSync(path, { readOnly: true });
  const rows = db.prepare("SELECT Key, Value FROM Storage WHERE Key LIKE 'note_%'").all() as {
    Key: string;
    Value: string;
  }[];
  const notes: CorpusNote[] = [];
  for (const row of rows) {
    if (!/^note_[0-9a-f-]{36}$/i.test(row.Key)) continue;
    const note = JSON.parse(row.Value) as { Blocks?: unknown };
    if (!Array.isArray(note.Blocks)) continue;
    notes.push({ key: row.Key, blocks: note.Blocks.map((b) => parseBlock(b)) });
  }
  db.close();
  return notes;
}

describe.skipIf(!dbPath)('real corpus round trip', () => {
  const notes = dbPath ? loadCorpus(dbPath) : [];

  it('loaded the corpus', () => {
    expect(notes.length).toBeGreaterThan(0);
    const total = notes.reduce((n, note) => n + countBlocks(note.blocks), 0);
    console.log(`corpus: ${String(notes.length)} notes, ${String(total)} blocks`);
  });

  it('maps every note without quarantining any of them', () => {
    const quarantined: string[] = [];
    for (const note of notes) {
      const result = mapper.toDoc(note.blocks);
      if (!result.ok) quarantined.push(`${note.key}: ${result.reason.message}`);
    }
    expect(quarantined).toEqual([]);
  });

  it('is byte-stable over three cycles for every note', () => {
    const drifted: string[] = [];
    for (const note of notes) {
      const first = cycle(note.blocks);
      const second = cycle(first);
      const third = cycle(second);
      if (wireBytes(second) !== wireBytes(first)) drifted.push(`${note.key} @ cycle 2`);
      else if (wireBytes(third) !== wireBytes(first)) drifted.push(`${note.key} @ cycle 3`);
    }
    expect(drifted).toEqual([]);
  });

  it('keeps every short id stable', () => {
    const churned: string[] = [];
    for (const note of notes) {
      const before = sids(cycle(note.blocks));
      const after = sids(cycle(cycle(note.blocks)));
      if (before.join(',') !== after.join(',')) churned.push(note.key);
    }
    expect(churned).toEqual([]);
  });

  it('preserves the first cycle against the stored bytes where the store is already canonical', () => {
    // Not every note is expected to match its stored bytes — legacy shapes are
    // normalized on the way in, which is the point of the normalization pass.
    // What this reports is how many needed it, so a surprise is visible.
    let identical = 0;
    for (const note of notes) {
      if (wireBytes(cycle(note.blocks)) === wireBytes(note.blocks)) identical += 1;
    }
    console.log(`notes already canonical: ${String(identical)}/${String(notes.length)}`);
    expect(identical).toBeGreaterThan(0);
  });
});

function countBlocks(blocks: readonly Block[]): number {
  let n = 0;
  for (const b of blocks) {
    n += 1;
    if (b.children) n += countBlocks(b.children);
  }
  return n;
}

function sids(blocks: readonly Block[]): string[] {
  const out: string[] = [];
  const walk = (list: readonly Block[]) => {
    for (const b of list) {
      out.push(b.sid);
      if (b.children) walk(b.children);
    }
  };
  walk(blocks);
  return out;
}
