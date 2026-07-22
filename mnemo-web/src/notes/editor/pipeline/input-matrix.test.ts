// @vitest-environment node

/**
 * The input matrix: the ways real text arrives that are not "a Latin character
 * typed into plain text".
 *
 * Every case here reaches the editor through `handleTextInput`, which is the one
 * hook that can suppress a character and rewrite the document underneath it. That
 * makes it the place where an input method, a surrogate pair or an inline atom
 * can turn a shortcut into data loss, so each is pinned rather than reasoned
 * about:
 *
 *  - **Composition** (CJK IME, dead keys, Vietnamese/Indic stacking), the text
 *    passed to `handleTextInput` mid-composition is intermediate, and the caret
 *    positions describe a range the IME still owns.
 *  - **Inline atoms in the line**: an equation occupies a position but
 *    contributes no text, so the line's text and the caret's offset disagree and
 *    marker arithmetic derived from one cannot be applied to the other.
 *  - **Astral characters, combining marks and RTL**: one "character" is not one
 *    position, and the visual order is not the logical order.
 */

import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../schema';
import { invariantPipeline } from '../pipeline/invariants';
import { backspaceStructural, splitBlock } from '../commands/structure';
import { inputTriggerPlugin } from './input-triggers';

const { schema, registry } = createEditorSchema();

/** U+00A0. Spelled by code point so it cannot be mistaken for a plain space. */
const NBSP = String.fromCharCode(0x00a0);

// --- doc builders -----------------------------------------------------------

function line(...content: PMNode[]): PMNode {
  return schema.nodes.line.create(null, content.length > 0 ? content : null);
}
function para(...content: PMNode[]): PMNode {
  return schema.nodes.paragraph.create(null, line(...content));
}
function text(value: string): PMNode {
  return schema.text(value);
}
function equation(latex: string): PMNode {
  return schema.nodes.equationSpan.create({ latex });
}
function doc(...blocks: PMNode[]): PMNode {
  return schema.nodes.doc.create(null, blocks);
}

/** Absolute position of `offset` inside the first block's line. */
function caretAt(offset: number): number {
  return 2 + offset;
}

interface TypeOptions {
  /** Simulates an active IME composition, which PM exposes as `view.composing`. */
  readonly composing?: boolean;
}

/**
 * Drives the input-trigger plugin the way a view would, so the guards under test
 * are exercised through the real entry point rather than through the handlers.
 */
function type(
  document: PMNode,
  caret: number,
  char: string,
  options: TypeOptions = {},
): { state: EditorState; handled: boolean } {
  const plugin = inputTriggerPlugin(registry);
  const initial = EditorState.create({
    schema,
    doc: document,
    selection: TextSelection.create(document, caret),
    plugins: [invariantPipeline(registry)],
  });
  const view = {
    state: initial,
    composing: options.composing ?? false,
    dispatch(tr: import('prosemirror-state').Transaction) {
      view.state = view.state.apply(tr);
    },
  };
  const handled = plugin.props.handleTextInput!(
    view as unknown as EditorView,
    caret,
    caret,
    char,
  );
  return { state: view.state, handled: Boolean(handled) };
}

/** The equation sources in a document, in order, empty when they were destroyed. */
function equations(document: PMNode): string[] {
  const found: string[] = [];
  document.descendants((node) => {
    if (node.type.name === 'equationSpan') found.push(String(node.attrs.latex));
  });
  return found;
}

function firstBlock(document: PMNode): PMNode {
  return document.firstChild!;
}

/** Runs a structural command at `caret` and returns the document it produced. */
function press(
  document: PMNode,
  caret: number,
  command: typeof splitBlock,
): { doc: PMNode; handled: boolean } {
  let state = EditorState.create({
    schema,
    doc: document,
    selection: TextSelection.create(document, caret),
    plugins: [invariantPipeline(registry)],
  });
  const handled = command(state, (tr) => {
    state = state.apply(tr);
  });
  return { doc: state.doc, handled };
}

// --- composition ------------------------------------------------------------

describe('composition', () => {
  it('does not fire a shortcut while an IME composition is active', () => {
    // A Japanese IME composing "-" as part of a candidate, a dead-key sequence,
    // or any other composed input: the character is not final and the range
    // belongs to the input method.
    const d = doc(para(text('-')));
    const { state, handled } = type(d, caretAt(1), ' ', { composing: true });

    expect(handled).toBe(false);
    expect(firstBlock(state.doc).type.name).toBe('paragraph');
    expect(firstBlock(state.doc).textContent).toBe('-');
  });

  it('still fires the same shortcut once composition has ended', () => {
    const d = doc(para(text('-')));
    const { state, handled } = type(d, caretAt(1), ' ', { composing: false });

    expect(handled).toBe(true);
    expect(firstBlock(state.doc).type.name).toBe('bulletItem');
  });

  it('does not convert a composed heading marker mid-composition', () => {
    const d = doc(para(text('#')));
    const { state, handled } = type(d, caretAt(1), ' ', { composing: true });

    expect(handled).toBe(false);
    expect(firstBlock(state.doc).type.name).toBe('paragraph');
  });
});

// --- inline atoms in the line ----------------------------------------------

describe('inline atoms in the line', () => {
  it('does not fire a leading marker when an atom precedes it, and keeps the atom', () => {
    // The line is [equation]"-" with the caret after the "-". The line's text is
    // "-" but the caret's offset is 2, because the atom holds a position and
    // contributes no text. Treating the offset as a character count would delete
    // the equation along with the marker.
    const d = doc(para(equation('E = mc^2'), text('-')));
    const { state, handled } = type(d, caretAt(2), ' ');

    expect(handled).toBe(false);
    expect(equations(state.doc)).toEqual(['E = mc^2']);
    expect(firstBlock(state.doc).type.name).toBe('paragraph');
  });

  it('does not clear a whole line whose only remaining content is an atom', () => {
    // The line is "#"[equation] with the caret after the "#". Everything after
    // the caret is textless, so a text-only emptiness check reads the line as
    // "just the marker" and a clearing conversion would destroy the equation.
    const d = doc(para(text('#'), equation('\\pi r^2')));
    const { state, handled } = type(d, caretAt(1), ' ');

    expect(handled).toBe(false);
    expect(equations(state.doc)).toEqual(['\\pi r^2']);
    expect(firstBlock(state.doc).type.name).toBe('paragraph');
  });

  it('still fires normally when the atom sits in a different block', () => {
    const d = doc(para(equation('x^2')), para(text('-')));
    const caret = 2 + para(equation('x^2')).nodeSize + 1;
    const { state, handled } = type(d, caret, ' ');

    expect(handled).toBe(true);
    expect(equations(state.doc)).toEqual(['x^2']);
    expect(state.doc.child(1).type.name).toBe('bulletItem');
  });
});

// --- structural commands over a line that is only an atom -------------------

describe('structural commands over inline atoms', () => {
  function bullet(...content: PMNode[]): PMNode {
    return schema.nodes.bulletItem.create(null, line(...content));
  }

  it('does not treat a bullet holding only an equation as an empty item', () => {
    // The "empty item + Enter leaves the list" rule converts with the content
    // cleared. An equation is the whole visible content of this item, so reading
    // it as empty would delete the formula to exit a list.
    const d = doc(bullet(equation('a^2 + b^2')));
    const { doc: after, handled } = press(d, caretAt(1), splitBlock);

    expect(handled).toBe(true);
    expect(equations(after)).toEqual(['a^2 + b^2']);
    expect(after.firstChild!.type.name).toBe('bulletItem');
  });

  it('does not delete a paragraph whose only content is an equation on Backspace', () => {
    // Backspace at offset 0 in an "empty" Text block deletes it outright. With
    // an equation as the block's content that is a one-keystroke, silent loss.
    const d = doc(para(text('keep me')), para(equation('\\int_0^1 x')));
    const caret = 2 + para(text('keep me')).nodeSize;
    const { doc: after, handled } = press(d, caret, backspaceStructural);

    expect(handled).toBe(true);
    expect(equations(after)).toEqual(['\\int_0^1 x']);
  });

  it('still treats a genuinely empty item as empty', () => {
    const d = doc(bullet());
    const { doc: after } = press(d, caretAt(0), splitBlock);

    expect(after.firstChild!.type.name).toBe('paragraph');
  });
});

// --- astral characters, combining marks, RTL --------------------------------

describe('astral, combining and bidirectional text', () => {
  it('keeps an emoji remainder intact when a leading marker converts', () => {
    // A surrogate pair is two positions for one glyph; the marker offset must be
    // measured in positions, not in glyphs, or the pair is split in half.
    const d = doc(para(text('-👩‍👩‍👧‍👦 family')));
    const { state, handled } = type(d, caretAt(1), ' ');

    expect(handled).toBe(true);
    expect(firstBlock(state.doc).type.name).toBe('bulletItem');
    expect(firstBlock(state.doc).textContent).toBe('👩‍👩‍👧‍👦 family');
  });

  it('keeps a combining mark attached to its base character', () => {
    const combining = 'é'; // e + COMBINING ACUTE ACCENT
    const d = doc(para(text(`-${combining}tude`)));
    const { state, handled } = type(d, caretAt(1), ' ');

    expect(handled).toBe(true);
    expect(firstBlock(state.doc).textContent).toBe(`${combining}tude`);
  });

  it('keeps RTL text intact, and does not treat its logical order as visual', () => {
    const d = doc(para(text('-مرحبا بالعالم')));
    const { state, handled } = type(d, caretAt(1), ' ');

    expect(handled).toBe(true);
    expect(firstBlock(state.doc).type.name).toBe('bulletItem');
    expect(firstBlock(state.doc).textContent).toBe('مرحبا بالعالم');
  });

  it('does not fire when an astral character precedes the marker', () => {
    // "𝔘-", the marker is not at the start of the line, so nothing converts.
    const d = doc(para(text('𝔘-')));
    const { state, handled } = type(d, caretAt(3), ' ');

    expect(handled).toBe(false);
    expect(firstBlock(state.doc).type.name).toBe('paragraph');
  });

  it('does not treat a non-breaking space as the trigger character', () => {
    // U+00A0 is what some keyboard layouts emit; it is not the Space the
    // shortcuts fire on, and treating it as one would convert unexpectedly.
    const d = doc(para(text('-')));
    const { state, handled } = type(d, caretAt(1), NBSP);

    expect(handled).toBe(false);
    expect(firstBlock(state.doc).type.name).toBe('paragraph');
  });
});
