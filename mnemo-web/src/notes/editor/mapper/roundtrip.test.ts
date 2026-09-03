/**
 * The round-trip proof: real-shaped blocks survive the full ProseMirror cycle,
 * three times, byte-identically.
 *
 * The chain under test is deliberately the whole one, `toJSON`/`fromJSON`
 * included:
 *
 *   Block[] -> doc -> doc.toJSON() -> Node.fromJSON() -> check() -> Block[]
 *
 * Skipping the JSON hop would make this suite pass while the editor loses data
 * in production. `computeAttrs` iterates the *spec's* attr names, so an
 * attribute the schema does not declare is dropped on `fromJSON` with no
 * warning, and the `checkAttrs` that would report it runs on the
 * already-filtered object, so it can never fire. That failure is invisible
 * without a `fromJSON` in the loop, and the negative controls at the bottom of
 * this file exist to prove the loop can still see it.
 *
 * Three cycles rather than one because the interesting bug is not "the mapper
 * changes something" but "the mapper changes something and then stops", a pass
 * that normalizes on cycle 1 and is stable after would look correct under a
 * single round trip while having silently rewritten the user's note.
 */

import { describe, expect, it } from 'vitest';
import { Node as PMNode, Schema } from 'prosemirror-model';
import { createEditorSchema } from '../schema';
import { createDocumentMapper } from './document';
import { scaleFixture, structuralFixtures } from './fixtures';
import { generateFixtures } from './generate';
import { parseBlock, serializeBlock } from '../../model/wire';
import type { Block } from '../../model/types';

/** Key-sorted stringify, so the comparison is about content and not key order. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

/** The wire bytes for a block list, which is what the round trip must preserve. */
function wireBytes(blocks: readonly Block[]): string {
  return canonical(blocks.map(serializeBlock));
}

const { schema, registry } = createEditorSchema();
const mapper = createDocumentMapper(schema, registry);

/** One full cycle, through PM JSON and back. */
function cycle(blocks: readonly Block[]): Block[] {
  const result = mapper.toDoc(blocks);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  result.doc.check();

  const json = result.doc.toJSON() as unknown;
  const restored = PMNode.fromJSON(schema, json as Parameters<typeof PMNode.fromJSON>[1]);
  restored.check();

  return mapper.fromDoc(restored);
}

describe('block <-> document round trip', () => {
  for (const fixture of structuralFixtures()) {
    it(`preserves "${fixture.name}" across three cycles`, () => {
      // The wire pass normalizes legacy shapes, so the fixture's own bytes are
      // not the baseline, the first cycle's output is. What is under test is
      // that nothing changes *after* that, which is what a user editing an
      // already-saved note experiences.
      const first = cycle(fixture.blocks);
      const second = cycle(first);
      const third = cycle(second);

      expect(wireBytes(second)).toBe(wireBytes(first));
      expect(wireBytes(third)).toBe(wireBytes(first));
    });

    it(`keeps every short id stable in "${fixture.name}"`, () => {
      // A re-minted sid is not a cosmetic change: the server treats a block with
      // no sid as new, and sids the user has already seen appear in chat history
      // and undo labels.
      const sidsOf = (blocks: readonly Block[]): string[] => {
        const out: string[] = [];
        const walk = (list: readonly Block[]) => {
          for (const b of list) {
            out.push(b.sid);
            if (b.children) walk(b.children);
          }
        };
        walk(blocks);
        return out;
      };

      const before = cycle(fixture.blocks);
      const after = cycle(before);
      expect(sidsOf(after)).toEqual(sidsOf(before));
      expect(sidsOf(before).every((s) => s.length > 0)).toBe(true);
    });
  }

  it('survives the JSON hop the persistence layer actually performs', () => {
    // Blocks reach the editor by being parsed from stored JSON, not as objects
    // built in a test. This runs the fixtures through that parse first.
    for (const fixture of structuralFixtures()) {
      const parsed = fixture.blocks.map((b) => parseBlock(JSON.parse(JSON.stringify(serializeBlock(b)))));
      const once = cycle(parsed);
      const twice = cycle(once);
      expect(wireBytes(twice), fixture.name).toBe(wireBytes(once));
    }
  });

  it('round-trips a 10,000 block document', () => {
    const fixture = scaleFixture(10_000);
    const first = cycle(fixture.blocks);
    const second = cycle(first);
    expect(wireBytes(second)).toBe(wireBytes(first));
  });
});

describe('quarantine', () => {
  it('refuses a two-column block with the wrong number of cells', () => {
    const [twoColumn] = structuralFixtures().find((f) => f.name.startsWith('two-column'))!.blocks;
    const broken: Block = { ...twoColumn, children: [twoColumn.children![0]] };
    const result = mapper.toDoc([broken]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.kind).toBe('invalid-shape');
    // The original blocks come back untouched, so the note can be exported and
    // repaired rather than opened empty and then autosaved over.
    expect(result.blocks).toEqual([broken]);
  });

  it('refuses an unknown wire type rather than degrading it to a paragraph', () => {
    const block = structuralFixtures()[0].blocks[0];
    const result = mapper.toDoc([{ ...block, type: 'NotARealType' as Block['type'] }]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.kind).toBe('unknown-type');
    expect(result.blocks).toHaveLength(1);
  });

  /**
   * The two above hand the mapper a block built in code. These start from the
   * bytes a newer version would actually write, because the parser used to
   * flatten both of them into shapes this build knows, and a quarantine that
   * cannot be reached from stored data protects nothing.
   */
  const storedText = {
    id: 'b1',
    sid: 'aaaaa',
    type: 'Text',
    order: 0,
    spans: [{ kind: 'text', text: 'hello' }],
    payload: { kind: 'empty' },
    meta: {},
  };

  it('refuses a stored block whose type this build does not know', () => {
    const result = mapper.toDoc([parseBlock({ ...storedText, type: 'Timeline' })]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.kind).toBe('unknown-type');
  });

  it('refuses a stored block whose payload kind this build does not know', () => {
    const result = mapper.toDoc([parseBlock({ ...storedText, payload: { kind: 'timeline', start: 1969 } })]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.kind).toBe('invalid-shape');
  });
});

/**
 * Negative controls. Each removes one declaration the round trip depends on and
 * requires the comparison to go red.
 *
 * Without these the suite proves only that the mapper agrees with itself. The
 * first harness wrote four controls that all "passed" because they mutated
 * the input and then compared the output against that same mutated input, a
 * faithful mapper passes that. These mutate the *schema* and compare against the
 * unmutated expectation, which is the only version that can fail.
 */
describe('negative controls', () => {
  function cycleWith(mutate: (nodes: Record<string, unknown>, marks: Record<string, unknown>) => void) {
    const base = createEditorSchema();
    const nodes = JSON.parse(JSON.stringify(base.registry.nodeSpecs)) as Record<string, unknown>;
    const marks = JSON.parse(JSON.stringify(base.registry.markSpecs)) as Record<string, unknown>;
    mutate(nodes, marks);

    // Specs survive a JSON clone only as data; `toDOM`/`parseDOM` are lost,
    // which is fine because nothing here renders. The attrs are the point.
    const broken = new Schema({ nodes, marks } as ConstructorParameters<typeof Schema>[0]);
    const brokenMapper = createDocumentMapper(broken, base.registry);

    return (blocks: readonly Block[]): Block[] => {
      const result = brokenMapper.toDoc(blocks);
      if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
      const json = result.doc.toJSON() as unknown;
      const restored = PMNode.fromJSON(broken, json as Parameters<typeof PMNode.fromJSON>[1]);
      return brokenMapper.fromDoc(restored);
    };
  }

  it('goes red when the meta attr declaration is removed', () => {
    const blocks = structuralFixtures().find((f) => f.name.startsWith('meta keys'))!.blocks;
    const brokenCycle = cycleWith((nodes) => {
      const paragraph = nodes.paragraph as { attrs: Record<string, unknown> };
      delete paragraph.attrs.meta;
    });
    expect(wireBytes(brokenCycle(blocks))).not.toBe(wireBytes(cycle(blocks)));
  });

  it('goes red when the sid attr declaration is removed', () => {
    const blocks = structuralFixtures()[0].blocks;
    const brokenCycle = cycleWith((nodes) => {
      const paragraph = nodes.paragraph as { attrs: Record<string, unknown> };
      delete paragraph.attrs.sid;
    });
    expect(wireBytes(brokenCycle(blocks))).not.toBe(wireBytes(cycle(blocks)));
  });

  it("goes red when the link mark's href attr declaration is removed", () => {
    // Removing the whole `link` mark would also fail, but by crashing, which
    // proves nothing about silent loss. Removing just its attr declaration
    // reproduces the real mechanism: the mark survives, `computeAttrs` drops the
    // href because the spec does not name it, and every link in the note comes
    // back as unstyled text with no error anywhere.
    const blocks = structuralFixtures()[0].blocks;
    const brokenCycle = cycleWith((_nodes, marks) => {
      const link = marks.link as { attrs: Record<string, unknown> };
      delete link.attrs.href;
    });
    expect(wireBytes(brokenCycle(blocks))).not.toBe(wireBytes(cycle(blocks)));
  });

  it('writes document position as the order on the first cycle, whatever was stored', () => {
    // Not a passthrough any more: every reader on the other side of the wire sorts
    // by this field, so the value that leaves here is the position, not the one loaded.
    const blocks = structuralFixtures().find((f) => f.name.startsWith('order values'))!.blocks;
    expect(blocks.map((b) => b.order)).toEqual([40, 10, 30]);
    expect(cycle(blocks).map((b) => b.order)).toEqual([0, 1, 2]);
  });
});

/**
 * Generated fixtures, run through the same three-cycle proof as the
 * structural ones. The seed is fixed so a CI failure names a reproducible
 * fixture rather than a random one that is gone by the time someone looks.
 */
describe('block <-> document round trip (generated)', () => {
  for (const fixture of generateFixtures(50, 12345)) {
    it(`preserves "${fixture.name}" across three cycles`, () => {
      const first = cycle(fixture.blocks);
      const second = cycle(first);
      const third = cycle(second);

      expect(wireBytes(second)).toBe(wireBytes(first));
      expect(wireBytes(third)).toBe(wireBytes(first));
    });
  }
});
