import { describe, expect, it } from 'vitest';
import { createEditorSchema } from './index';
import { allBlockTypes, type BlockType } from '../../model/types';

describe('editor schema', () => {
  const { schema, registry } = createEditorSchema();

  it('assembles without a registry validation error', () => {
    expect(schema.nodes.doc).toBeDefined();
    expect(schema.topNodeType.name).toBe('doc');
  });

  it('covers every wire block type exactly once', () => {
    const covered = new Set<BlockType>();
    for (const module of registry.modules) {
      for (const wire of module.wireTypes) {
        expect(covered.has(wire), `${wire} is owned twice`).toBe(false);
        covered.add(wire);
      }
    }
    expect([...covered].sort()).toEqual([...allBlockTypes].sort());
  });

  it('maps the four heading levels onto one node without losing wire identity', () => {
    const heading = registry.byWireType.get('Heading3');
    expect(heading?.nodeName).toBe('heading');
    for (const level of [1, 2, 3, 4]) {
      const wire = `Heading${String(level)}` as BlockType;
      expect(registry.byWireType.get(wire)?.nodeName).toBe('heading');
    }
    // One node, four types — the property that lets a level change keep the sid.
    const nodes = new Set(
      (['Heading1', 'Heading2', 'Heading3', 'Heading4'] as BlockType[]).map(
        (t) => registry.byWireType.get(t)?.nodeName,
      ),
    );
    expect(nodes.size).toBe(1);
  });

  it('gives every block node the common attrs', () => {
    for (const module of registry.modules) {
      const type = schema.nodes[module.nodeName];
      for (const attr of ['id', 'sid', 'order', 'meta']) {
        expect(type.spec.attrs?.[attr], `${module.nodeName} is missing ${attr}`).toBeDefined();
      }
    }
  });

  it('starts every block with a line', () => {
    for (const module of registry.modules) {
      expect(
        schema.nodes[module.nodeName].spec.content,
        `${module.nodeName} does not start with a line`,
      ).toMatch(/^(line|codeLine)\b/);
    }
  });

  it('forbids marks structurally on source lines', () => {
    expect(schema.nodes.codeLine.spec.marks).toBe('');
    expect(schema.nodes.codeBlock.spec.content).toMatch(/^codeLine/);
    expect(schema.nodes.sketch.spec.content).toMatch(/^codeLine/);
  });

  it('requires exactly two columns', () => {
    expect(schema.nodes.twoColumn.spec.content).toBe('line columnGroup columnGroup');
  });

  it('lets a column group hold another two-column block', () => {
    // Recursion is a property of the wire format, so the schema has to keep it
    // or deeper imported data cannot round-trip.
    const columnGroup = schema.nodes.columnGroup;
    expect(columnGroup.contentMatch.matchType(schema.nodes.line)).toBeTruthy();
    const afterLine = columnGroup.contentMatch.matchType(schema.nodes.line);
    expect(afterLine?.matchType(schema.nodes.twoColumn)).toBeTruthy();
  });

  it('serializes a mark set identically whatever order it was applied in', () => {
    // The canonicalization pass we did not have to write: `addToSet` inserts by
    // declaration rank, so applying bold-then-italic and italic-then-bold
    // produce the same array. Asserted through behaviour rather than through
    // `MarkType.rank`, which is an undocumented internal.
    const strong = schema.marks.strong.create();
    const em = schema.marks.em.create();
    const link = schema.marks.link.create({ href: 'https://example.com' });

    const forward = link.addToSet(em.addToSet(strong.addToSet([])));
    const backward = strong.addToSet(em.addToSet(link.addToSet([])));

    expect(forward.map((m) => m.type.name)).toEqual(backward.map((m) => m.type.name));
    expect(forward.map((m) => m.type.name)).toEqual(['strong', 'em', 'link']);
  });

  it('lets a span carry both sub and sup, because the wire format does', () => {
    // Tempting to exclude these. But C# clears the
    // pair in its command layer, not its serializer, so both-true is
    // representable — and the frozen cross-language span fixture contains it,
    // since its generator rolls the two flags independently. `excludes` here
    // would silently drop `sub` on load.
    const sub = schema.marks.sub.create();
    const sup = schema.marks.sup.create();
    const set = sup.addToSet(sub.addToSet([]));
    expect(set.map((m) => m.type.name).sort()).toEqual(['sub', 'sup']);
  });

  it('does not exclude code from other marks, because the wire format does not', () => {
    const code = schema.marks.codeMark.create();
    const strong = schema.marks.strong.create();
    const set = code.addToSet(strong.addToSet([]));
    expect(set.map((m) => m.type.name).sort()).toEqual(['codeMark', 'strong']);
  });

  it('lets an inline atom carry marks', () => {
    // `marks: "_"` governs permitted content; a node always may carry its own.
    const atom = schema.nodes.equationSpan.create({ latex: 'x^2' });
    const bolded = atom.mark([schema.marks.strong.create()]);
    expect(bolded.marks.map((m) => m.type.name)).toEqual(['strong']);
  });
});
