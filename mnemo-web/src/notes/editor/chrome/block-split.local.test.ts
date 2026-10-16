/**
 * LOCAL GATE, skipped unless MNEMO_CORPUS_DB names a copy of a real profile database.
 *
 * Wraps blocks into two-column layouts in every note. Checks that no block is lost or
 * duplicated, that the document stays valid and that one undo restores the note.
 */

import { describe, expect, it } from 'vitest';
import type { EditorState } from 'prosemirror-state';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { parseBlock } from '../../model/wire';
import type { Block } from '../../model/types';
import { undo } from '../history';
import { splitBlockIntoColumnsTransaction } from './block-move';

const dbPath = process.env.MNEMO_CORPUS_DB;
const sqlite = dbPath ? await import('node:sqlite') : null;

/** Most splits tried per note, so a very large note does not dominate the run. */
const PER_NOTE = 40;

function loadNotes(path: string): { key: string; blocks: Block[] }[] {
  if (!sqlite) return [];
  const db = new sqlite.DatabaseSync(path, { readOnly: true });
  const rows = db.prepare("SELECT Key, Value FROM Storage WHERE Key LIKE 'note_%'").all() as {
    Key: string;
    Value: string;
  }[];
  const notes: { key: string; blocks: Block[] }[] = [];
  for (const row of rows) {
    if (!/^note_[0-9a-f-]{36}$/i.test(row.Key)) continue;
    const note = JSON.parse(row.Value) as { Blocks?: unknown };
    if (Array.isArray(note.Blocks)) notes.push({ key: row.Key, blocks: note.Blocks.map((b) => parseBlock(b)) });
  }
  db.close();
  return notes;
}

const CRLF = /\r\n/g;
const containers = new Set(['twoColumn', 'columnGroup', 'line', 'tableRow']);

function leaves(state: EditorState): string[] {
  const out: string[] = [];
  state.doc.descendants((node) => {
    if (node.attrs.sid === undefined || containers.has(node.type.name)) return;
    // Stored text uses CRLF. The editor rewrites it to LF on its first transaction.
    const text = (node.firstChild?.textContent ?? '').replace(CRLF, '\n');
    out.push(`${String(node.attrs.sid)}:${node.type.name}:${text}`);
  });
  return out.sort();
}

describe.skipIf(!dbPath)('real corpus two-column split', () => {
  const notes = dbPath ? loadNotes(dbPath) : [];

  it('keeps every block and undoes in one step across the corpus', () => {
    let tried = 0;
    const failures: string[] = [];
    for (const note of notes) {
      const built = buildNoteEditState(note.blocks);
      if (!built.ok) continue;
      const state = built.state;
      const before = leaves(state);
      const tops: { pos: number; sid: string }[] = [];
      state.doc.forEach((node, pos) => tops.push({ pos, sid: String(node.attrs.sid) }));
      const nested: { pos: number; sid: string }[] = [];
      state.doc.descendants((node, pos) => {
        if (nested.length < PER_NOTE && state.doc.resolve(pos).depth > 0 && !containers.has(node.type.name)) {
          if (node.attrs.sid !== undefined) nested.push({ pos, sid: String(node.attrs.sid) });
        }
      });
      const pairs: [{ pos: number; sid: string }, { pos: number; sid: string }][] = [];
      for (let i = 0; i + 1 < tops.length && pairs.length < PER_NOTE; i++) {
        pairs.push([tops[i], tops[i + 1]], [tops[i + 1], tops[i]]);
      }
      if (tops.length > 0) for (const source of nested) pairs.push([source, tops[tops.length - 1]]);

      for (const [source, target] of pairs) {
        const tr = splitBlockIntoColumnsTransaction(state, source.pos, source.sid, target.pos, target.sid, 'left');
        if (!tr) continue;
        tried += 1;
        const next = state.apply(tr);
        next.doc.check();
        const after = leaves(next);
        const lost = before.filter((x) => !after.includes(x));
        const extra = after.filter((x) => !before.includes(x));
        // The lane the block leaves gets one blank paragraph. Nothing else may be added.
        if (lost.length > 0 || extra.length > 1 || after.length < before.length) failures.push(`${note.key} ${source.sid} lost=${JSON.stringify(lost)} extra=${JSON.stringify(extra)} ${String(before.length)}->${String(after.length)}`);
        let restored = next;
        undo(next, (undoTr) => {
          restored = next.apply(undoTr);
        });
        if (!restored.doc.eq(state.doc)) failures.push(`${note.key} ${source.sid} undo`);
      }
    }
    console.log(`corpus split: ${String(notes.length)} notes, ${String(tried)} splits`);
    expect(tried).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  }, 300_000);
});
