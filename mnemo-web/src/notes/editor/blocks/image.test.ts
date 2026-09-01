// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { DOMParser as PMDOMParser, DOMSerializer, Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../schema';

const { schema, registry } = createEditorSchema();

function serializeToContainer(attrs: Record<string, unknown> = { path: 'aaaa.png', width: 320, align: 'center' }): HTMLElement {
  const image = schema.nodes.image.create(attrs, schema.nodes.line.create(null, schema.text('Sunset')));
  const docNode = schema.nodes.doc.create(null, [image]);
  const container = document.createElement('div');
  container.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(docNode.content, { document }));
  return container;
}

const CROP = { x: 0.25, y: 0.5, w: 0.5, h: 0.25, aspect: 2 };

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
    expect(imported.attrs.crop).toBeNull();
  });
});

describe('image crop attr', () => {
  it('defaults to none, and an image without one carries no crop markup', () => {
    const node = schema.nodes.image.create({ path: 'aaaa.png' }, schema.nodes.line.create(null));
    expect(node.attrs.crop).toBeNull();
    expect(serializeToContainer().querySelector('figure')!.hasAttribute('data-crop')).toBe(false);
  });

  it('survives the JSON hop, which is where an undeclared attr is silently dropped', () => {
    const node = schema.nodes.image.create(
      { path: 'aaaa.png', crop: CROP },
      schema.nodes.line.create(null, schema.text('Sunset')),
    );
    const restored = PMNode.fromJSON(schema, node.toJSON() as Parameters<typeof PMNode.fromJSON>[1]);
    expect(restored.attrs.crop).toEqual(CROP);
  });

  it('re-parses its own markup, so an internal copy keeps the window', () => {
    const container = serializeToContainer({ path: 'aaaa.png', width: 320, align: 'center', crop: CROP });
    const round = PMDOMParser.fromSchema(schema).parse(container).firstChild!;
    expect(round.attrs.crop).toEqual(CROP);
  });

  it('reads markup that does not hold a usable window as no crop', () => {
    for (const raw of ['not json', '{"x":0.1,"y":0.1,"w":0.5,"h":0.5}', '{"x":2,"y":0,"w":1,"h":1,"aspect":1}']) {
      const container = document.createElement('div');
      container.innerHTML = `<figure data-image="a.png" data-crop='${raw}'><p></p></figure>`;
      const parsed = PMDOMParser.fromSchema(schema).parse(container).firstChild!;
      expect(parsed.attrs.crop).toBeNull();
    }
  });

  it('reserves the cropped height rather than the guessed one', () => {
    const estimate = registry.estimators.get('image')!;
    const ctx = { availableWidth: 600, estimateChild: () => 0 };
    const cropped = schema.nodes.image.create({ path: 'a.png', crop: CROP }, schema.nodes.line.create(null));
    const plain = schema.nodes.image.create({ path: 'a.png' }, schema.nodes.line.create(null));

    // 600 wide at 2:1 is 300 tall, plus the caption row the guess also allows for.
    expect(estimate(cropped, ctx)).toBe(332);
    expect(estimate(plain, ctx)).toBe(428);
  });
});
