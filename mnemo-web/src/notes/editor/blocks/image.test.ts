// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { DOMParser as PMDOMParser, DOMSerializer } from 'prosemirror-model';

import { createEditorSchema } from '../schema';

const { schema } = createEditorSchema();

function serializeToContainer(): HTMLElement {
  const image = schema.nodes.image.create(
    { path: 'aaaa.png', width: 320, align: 'center' },
    schema.nodes.line.create(null, schema.text('Sunset')),
  );
  const docNode = schema.nodes.doc.create(null, [image]);
  const container = document.createElement('div');
  container.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(docNode.content, { document }));
  return container;
}

describe('image DOM round trip', () => {
  it('re-parses its own serialized markup, which is the internal clipboard path', () => {
    // An internal copy serializes through toDOM and pastes through parseDOM; a block
    // that cannot read its own output is destroyed by copy/paste.
    const container = serializeToContainer();
    expect(container.querySelector('figure[data-image="aaaa.png"]')).not.toBeNull();

    const parsed = PMDOMParser.fromSchema(schema).parse(container);
    const round = parsed.firstChild!;
    expect(round.type.name).toBe('image');
    expect(round.attrs.path).toBe('aaaa.png');
    expect(round.attrs.width).toBe(320);
    expect(round.attrs.align).toBe('center');
    expect(round.firstChild!.textContent).toBe('Sunset');
  });

  it('imports a foreign img tag with its alt and width', () => {
    const container = document.createElement('div');
    container.innerHTML = '<img src="https://example.com/pic.png" alt="a picture" width="200">';

    const parsed = PMDOMParser.fromSchema(schema).parse(container);
    const imported = parsed.firstChild!;
    expect(imported.type.name).toBe('image');
    expect(imported.attrs.path).toBe('https://example.com/pic.png');
    expect(imported.attrs.alt).toBe('a picture');
    expect(imported.attrs.width).toBe(200);
  });
});
