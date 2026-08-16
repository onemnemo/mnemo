// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../editor/schema';
import { withFreshIdentity } from './clear-identity';

const { schema, registry } = createEditorSchema();

const line = (text?: string) => schema.nodes.line.create(null, text ? schema.text(text) : null);
const para = (text: string, sid: string, ...children: PMNode[]) =>
  schema.nodes.paragraph.create({ sid, id: sid }, [line(text), ...children]);
const cell = (sid: string, ...blocks: PMNode[]) =>
  schema.nodes.columnGroup.create({ sid, id: sid }, [line(), ...blocks]);
const twoColumn = (sid: string, left: PMNode, right: PMNode) =>
  schema.nodes.twoColumn.create({ sid, id: sid, splitRatio: 0.5 }, [line(), left, right]);

const closed = (...nodes: PMNode[]) => new Slice(Fragment.fromArray(nodes), 0, 0);

/** Every block node's sid in document order, so a cleared slice is easy to assert. */
function blockIdentifiers(slice: Slice): { id: string; sid: string }[] {
  const out: { id: string; sid: string }[] = [];
  slice.content.descendants((node) => {
    if (registry.byNodeName.has(node.type.name)) {
      out.push({ id: String(node.attrs.id), sid: String(node.attrs.sid) });
    }
    return true;
  });
  return out;
}

describe('withFreshIdentity', () => {
  it('blanks id and sid on a top-level block', () => {
    const cleared = withFreshIdentity(closed(para('one', 's1')), registry);
    expect(blockIdentifiers(cleared)).toEqual([{ id: '', sid: '' }]);
  });

  it('blanks identity on blocks nested inside a two-column row', () => {
    const row = twoColumn('tc', cell('cl', para('a', 'sA')), cell('cr', para('b', 'sB')));
    const cleared = withFreshIdentity(closed(row), registry);
    // The row, both cells and both inner paragraphs are all identified blocks.
    expect(blockIdentifiers(cleared)).toEqual([
      { id: '', sid: '' },
      { id: '', sid: '' },
      { id: '', sid: '' },
      { id: '', sid: '' },
      { id: '', sid: '' },
    ]);
  });

  it('preserves text, marks and structure while clearing identity', () => {
    const bold = schema.marks.strong.create();
    const marked = schema.nodes.paragraph.create({ sid: 's1', id: 's1' }, [
      schema.nodes.line.create(null, schema.text('bold', [bold])),
    ]);
    const cleared = withFreshIdentity(closed(marked), registry);
    const block = cleared.content.child(0);
    expect(block.attrs.sid).toBe('');
    expect(block.textContent).toBe('bold');
    expect(block.child(0).child(0).marks[0]?.type.name).toBe('strong');
  });

  it('leaves the open depths of the slice untouched', () => {
    const open = new Slice(Fragment.fromArray([para('one', 's1')]), 1, 1);
    const cleared = withFreshIdentity(open, registry);
    expect(cleared.openStart).toBe(1);
    expect(cleared.openEnd).toBe(1);
  });
});
