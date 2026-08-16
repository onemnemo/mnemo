// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Fragment, Slice, type Mark } from 'prosemirror-model';

import { createEditorSchema } from '../editor/schema';
import { dropUnsafeLinks } from './scrub-marks';

const { schema } = createEditorSchema();

const linked = (text: string, href: string) =>
  schema.nodes.paragraph.create(
    { sid: 'p', id: 'p' },
    schema.nodes.line.create(null, schema.text(text, [schema.marks.link.create({ href })])),
  );

const closed = (href: string) => new Slice(Fragment.fromArray([linked('x', href)]), 0, 0);

function marksOf(slice: Slice): Mark[] {
  const out: Mark[] = [];
  slice.content.descendants((node) => {
    for (const mark of node.marks) out.push(mark);
    return true;
  });
  return out;
}

describe('dropUnsafeLinks', () => {
  it('strips a javascript: link mark', () => {
    const scrubbed = dropUnsafeLinks(closed('javascript:alert(1)'));
    expect(marksOf(scrubbed).some((m) => m.type.name === 'link')).toBe(false);
    // The text itself is untouched.
    expect(scrubbed.content.child(0).textContent).toBe('x');
  });

  it('keeps a safe link mark', () => {
    const scrubbed = dropUnsafeLinks(closed('https://ok.test'));
    const link = marksOf(scrubbed).find((m) => m.type.name === 'link');
    expect(link?.attrs.href).toBe('https://ok.test');
  });

  it('returns the same slice instance when there is nothing to strip', () => {
    const slice = closed('https://ok.test');
    expect(dropUnsafeLinks(slice)).toBe(slice);
  });
});
