/**
 * The read-state builder: a note's blocks become a mountable `EditorState`, or a
 * quarantine reason, and never an exception. The 10k case is the size gate in
 * test form, a deterministic large fixture loads into a *complete, checked*
 * state, which is what "renders read-only and deterministic" has to mean before
 * any pixel is on screen.
 */

import { describe, expect, it } from 'vitest';
import { buildNoteReadState } from './build-state';
import { block, scaleFixture, span } from '../editor/mapper/fixtures';
import type { Block, BlockType } from '../model/types';

describe('buildNoteReadState', () => {
  it('turns ordinary blocks into a checked state that mirrors them', () => {
    const blocks = [
      block('Heading1', [span('Title', { bold: true })]),
      block('Text', [span('a paragraph')]),
      block('BulletList', [span('one')]),
    ];
    const result = buildNoteReadState(blocks);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // No throw is the contract; check() again so the assertion states it.
    expect(() => result.state.doc.check()).not.toThrow();
    expect(result.state.doc.childCount).toBe(3);
  });

  it('seeds an empty note rather than quarantining it', () => {
    // Blocks:null / [] is ordinary (a new or bodyless note), not corruption.
    const result = buildNoteReadState([]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.doc.childCount).toBe(1);
  });

  it('quarantines content the schema cannot represent, with a reason', () => {
    // A Code block carrying a checklist payload is a type/payload disagreement:
    // the wire format allows it, the schema decomposes payload per type, so it
    // is quarantined holding its bytes rather than silently coerced.
    const mismatched: Block = block('Code', [span('x')], { kind: 'checklist', checked: true });
    const result = buildNoteReadState([mismatched]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.message).toBeTruthy();
    expect(typeof result.reason.kind).toBe('string');
  });

  it('reports an unmapped wire type as quarantine, not a crash', () => {
    const alien: Block = { ...block('Text', [span('x')]), type: 'Nonesuch' as BlockType };
    const result = buildNoteReadState([alien]);
    expect(result.ok).toBe(false);
  });

  describe('the 10k gate', () => {
    it('loads a deterministic 10k fixture into a complete, checked state', () => {
      const blocks = scaleFixture(10_000).blocks;
      const result = buildNoteReadState(blocks);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.state.doc.childCount).toBe(10_000);
      // "Complete" = every top-level block landed; "checked" = the whole
      // document satisfies its content expressions, not just the pieces.
      expect(() => result.state.doc.check()).not.toThrow();
    });

    it('is deterministic, the same fixture yields an equal document', () => {
      const a = buildNoteReadState(scaleFixture(2_000).blocks);
      const b = buildNoteReadState(scaleFixture(2_000).blocks);
      expect(a.ok && b.ok).toBe(true);
      if (!a.ok || !b.ok) return;
      expect(a.state.doc.eq(b.state.doc)).toBe(true);
    });
  });
});
