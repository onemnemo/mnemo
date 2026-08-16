// @vitest-environment jsdom

/**
 * What a callout writes and what it reads back.
 *
 * The glyph is drawn by the block's view, but the serialized shape is older than
 * that view and is shared with every note already on disk and with anything
 * copied out of an earlier build, so it stays the bare aside with the glyph in
 * an attribute. These are the two directions that has to keep working.
 */

import { describe, expect, it } from 'vitest';
import { DOMParser as PMDOMParser, DOMSerializer } from 'prosemirror-model';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../schema';

const { schema } = createEditorSchema();

function serialize(...callouts: PMNode[]): HTMLElement {
  const docNode = schema.nodes.doc.create(null, callouts);
  const container = document.createElement('div');
  container.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(docNode.content, { document }));
  return container;
}

function callout(emoji: string, tone: string, text: string): PMNode {
  return schema.nodes.callout.create(
    { emoji, tone },
    schema.nodes.line.create(null, schema.text(text)),
  );
}

function parse(container: HTMLElement): PMNode {
  return PMDOMParser.fromSchema(schema).parse(container);
}

describe('callout DOM round trip', () => {
  it('writes the bare aside the older builds wrote, with no chrome of the view in it', () => {
    const container = serialize(callout('💡', 'note', 'remember'));
    const aside = container.querySelector('aside[data-callout]');
    expect(aside).not.toBeNull();
    expect(aside!.getAttribute('data-callout-emoji')).toBe('💡');
    expect(aside!.getAttribute('data-callout-tone')).toBe('note');
    // The button is the live view's business; a copy that carried it would paste
    // the glyph in as text.
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('.notes-callout-glyph')).toBeNull();
    expect(aside!.textContent).toBe('remember');
  });

  it('re-parses its own markup, which is the external clipboard path', () => {
    const round = parse(serialize(callout('💡', 'warn', 'careful'))).firstChild!;
    expect(round.type.name).toBe('callout');
    expect(round.attrs.emoji).toBe('💡');
    expect(round.attrs.tone).toBe('warn');
    expect(round.textContent).toBe('careful');
  });

  it('carries a multi-codepoint glyph through unbroken', () => {
    const round = parse(serialize(callout('🧑‍🚀', 'note', 'picked'))).firstChild!;
    expect(round.attrs.emoji).toBe('🧑‍🚀');
  });

  it('keeps a glyph-less callout glyph-less rather than defaulting one in', () => {
    const round = parse(serialize(callout('', 'note', 'plain'))).firstChild!;
    expect(round.type.name).toBe('callout');
    expect(round.attrs.emoji).toBe('');
  });

  it('pastes an aside from a build that wrote no tone, and one that wrote nothing at all', () => {
    const container = document.createElement('div');
    container.innerHTML =
      '<aside data-callout data-callout-emoji="📌">pinned</aside>' +
      '<aside data-callout>bare</aside>';
    const parsed = parse(container);

    const withEmoji = parsed.child(0);
    expect(withEmoji.type.name).toBe('callout');
    expect(withEmoji.attrs.emoji).toBe('📌');
    // A missing tone reads as the default rather than as an empty one, which
    // would tint the callout with nothing.
    expect(withEmoji.attrs.tone).toBe('note');
    expect(withEmoji.textContent).toBe('pinned');

    const bare = parsed.child(1);
    expect(bare.type.name).toBe('callout');
    expect(bare.attrs.emoji).toBe('');
    expect(bare.attrs.tone).toBe('note');
  });
});
