// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import type { Decoration } from 'prosemirror-view';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { block, span } from '../mapper/fixtures';
import { splitBlock } from '../commands/structure';
import type { BlockRegistry, HeightEstimator } from '../registry/build';
import { intrinsicSizePlugin, intrinsicSizeStyle, NOTE_CONTENT_WIDTH } from './intrinsic-size';

type Blocks = Parameters<typeof buildNoteEditState>[0][number][];

/** The document a note opens with, carrying only the plugin under test. */
function mount(blocks: Blocks, registryFor: (r: BlockRegistry) => BlockRegistry = (r) => r) {
  const built = buildNoteEditState(blocks);
  if (!built.ok) throw new Error('fixture did not build');
  const plugin = intrinsicSizePlugin(registryFor(built.registry), NOTE_CONTENT_WIDTH);
  const state = EditorState.create({
    schema: built.state.schema,
    doc: built.state.doc,
    plugins: [plugin],
  });
  return { state, plugin, registry: built.registry };
}

function decorations(plugin: ReturnType<typeof intrinsicSizePlugin>, state: EditorState) {
  return plugin.getState(state)?.find() ?? [];
}

/** The style the decoration will write, which is the only thing the engine sees. */
function styleOf(deco: Decoration): string {
  return (deco as unknown as { type: { attrs: Record<string, string> } }).type.attrs.style;
}

/** The reserved height, read back out of the style the block would carry. */
function reservedHeight(deco: Decoration): number {
  const match = /contain-intrinsic-size:auto (\d+)px/.exec(styleOf(deco));
  if (!match) throw new Error(`no reserved height in ${styleOf(deco)}`);
  return Number(match[1]);
}

function heightsOf(blocks: Blocks): number[] {
  const { state, plugin } = mount(blocks);
  return decorations(plugin, state).map(reservedHeight);
}

/** Records which module estimated, so a rebuild's real cost is observable. */
function countingRegistry(registry: BlockRegistry): { registry: BlockRegistry; calls: string[] } {
  const calls: string[] = [];
  const estimators = new Map<string, HeightEstimator>(
    [...registry.estimators].map(([name, estimate]) => [
      name,
      (node, ctx) => {
        calls.push(name);
        return estimate(node, ctx);
      },
    ]),
  );
  return { registry: { ...registry, estimators }, calls };
}

function apply(state: EditorState, change: (tr: Transaction) => Transaction): EditorState {
  return state.apply(change(state.tr));
}

describe('what gets a reserved height', () => {
  it('gives one to every top-level block', () => {
    const { state, plugin } = mount([
      block('Heading1', [span('Title')]),
      block('Text', [span('a paragraph')]),
      block('Divider', []),
    ]);
    const decos = decorations(plugin, state);

    expect(decos).toHaveLength(3);
    for (const deco of decos) expect(reservedHeight(deco)).toBeGreaterThan(0);
  });

  it('declares the height twice, so an engine without `auto` still reserves one', () => {
    const [{ state, plugin }] = [mount([block('Text', [span('hi')])])];
    const style = styleOf(decorations(plugin, state)[0]);

    // The plain length is first so the `auto` form overrides it where it parses,
    // and survives alone where it does not.
    expect(style).toBe(intrinsicSizeStyle(34));
    expect(style.indexOf('contain-intrinsic-size:34px')).toBeLessThan(
      style.indexOf('contain-intrinsic-size:auto'),
    );
  });

  it('leaves a block with no estimate to the stylesheet rather than reserving zero', () => {
    const withoutParagraph = (registry: BlockRegistry): BlockRegistry => {
      const estimators = new Map(registry.estimators);
      estimators.delete('paragraph');
      return { ...registry, estimators };
    };
    const { state, plugin } = mount(
      [block('Heading1', [span('Title')]), block('Text', [span('body')])],
      withoutParagraph,
    );

    const decos = decorations(plugin, state);
    expect(decos).toHaveLength(1);
    expect(decos[0].from).toBe(0);
  });

  it('leaves nested blocks alone, because only top-level blocks are skipped', () => {
    const { state, plugin } = mount([
      block('TwoColumn', [span('')], { kind: 'twoColumn', splitRatio: 0.5 }, {
        children: [
          block('ColumnGroup', [span('')], { kind: 'empty' }, {
            children: [block('Text', [span('left')])],
          }),
          block('ColumnGroup', [span('')], { kind: 'empty' }, {
            children: [block('Text', [span('right')])],
          }),
        ],
      }),
    ]);

    expect(decorations(plugin, state)).toHaveLength(1);
  });
});

describe('the height each module reserves', () => {
  it('scales a heading by its level rather than by the body metric', () => {
    const [h1, h2, body] = heightsOf([
      block('Heading1', [span('hi')]),
      block('Heading2', [span('hi')]),
      block('Text', [span('hi')]),
    ]);

    expect(h1).toBeGreaterThan(h2);
    expect(h2).toBeGreaterThan(body);
  });

  it('grows a paragraph that wraps', () => {
    const [short, long] = heightsOf([
      block('Text', [span('one line')]),
      block('Text', [span('word '.repeat(200))]),
    ]);

    expect(long).toBeGreaterThan(short * 5);
  });

  it('counts source lines for code, which does not wrap', () => {
    const source = 'one\ntwo\nthree';
    const [code] = heightsOf([
      block('Code', [span(source)], { kind: 'code', language: 'csharp', source }),
    ]);
    const [oneLine] = heightsOf([
      block('Code', [span('one')], { kind: 'code', language: 'csharp', source: 'one' }),
    ]);

    expect(code).toBe(oneLine + 2 * 26);
  });

  it('asks a container for its tallest lane, not for its own empty line', () => {
    const tall = Array.from({ length: 4 }, () => block('Text', [span('deep')]));
    const [container] = heightsOf([
      block('TwoColumn', [span('')], { kind: 'twoColumn', splitRatio: 0.5 }, {
        children: [
          block('ColumnGroup', [span('')], { kind: 'empty' }, { children: tall }),
          block('ColumnGroup', [span('')], { kind: 'empty' }, {
            children: [block('Text', [span('short')])],
          }),
        ],
      }),
    ]);
    const [singleLine] = heightsOf([block('Text', [span('deep')])]);

    // Without the recursive estimate a container would reserve one empty line
    // and collapse a whole nested column to nothing.
    expect(container).toBeGreaterThan(singleLine * 4);
  });
});

describe('keeping the set up to date', () => {
  it('re-estimates only the block a keystroke landed in', () => {
    const built = buildNoteEditState([
      block('Text', [span('one')]),
      block('Text', [span('two')]),
      block('Text', [span('three')]),
    ]);
    if (!built.ok) throw new Error('fixture did not build');
    const counted = countingRegistry(built.registry);
    const plugin = intrinsicSizePlugin(counted.registry, NOTE_CONTENT_WIDTH);
    let state = EditorState.create({
      schema: built.state.schema,
      doc: built.state.doc,
      plugins: [plugin],
    });

    expect(counted.calls).toHaveLength(3);
    counted.calls.length = 0;

    state = apply(state, (tr) => tr.insertText('X', 4));

    // The document-wide alternative is what makes a large note unusable: one
    // estimate per keystroke instead of ten thousand.
    expect(counted.calls).toEqual(['paragraph']);
    expect(decorations(plugin, state)).toHaveLength(3);
  });

  it('re-estimates both halves of a split', () => {
    const built = buildNoteEditState([block('Text', [span('abcd')])]);
    if (!built.ok) throw new Error('fixture did not build');
    const counted = countingRegistry(built.registry);
    const plugin = intrinsicSizePlugin(counted.registry, NOTE_CONTENT_WIDTH);
    const state = EditorState.create({
      schema: built.state.schema,
      doc: built.state.doc,
      plugins: [plugin],
      selection: TextSelection.create(built.state.doc, 4),
    });
    counted.calls.length = 0;

    let next = state;
    splitBlock(state, (tr) => {
      next = state.apply(tr);
    });

    expect(next.doc.childCount).toBe(2);
    expect(decorations(plugin, next)).toHaveLength(2);
    expect(counted.calls).toEqual(['paragraph', 'paragraph']);
  });

  it('keeps every block covered when one is deleted', () => {
    const { state, plugin } = mount([
      block('Text', [span('one')]),
      block('Text', [span('two')]),
      block('Text', [span('three')]),
    ]);
    const first = state.doc.child(0);
    const next = apply(state, (tr) => tr.delete(0, first.nodeSize));

    const decos = decorations(plugin, next);
    expect(decos).toHaveLength(2);
    // Positions have to describe the new document, not the old one: a node
    // decoration whose range no longer matches a node is silently dropped.
    expect(decos.map((d) => d.from)).toEqual([0, next.doc.child(0).nodeSize]);
  });

  it('does no work for a transaction that changes no content', () => {
    const built = buildNoteEditState([block('Text', [span('one')])]);
    if (!built.ok) throw new Error('fixture did not build');
    const counted = countingRegistry(built.registry);
    const plugin = intrinsicSizePlugin(counted.registry, NOTE_CONTENT_WIDTH);
    const state = EditorState.create({
      schema: built.state.schema,
      doc: built.state.doc,
      plugins: [plugin],
    });
    counted.calls.length = 0;

    apply(state, (tr) => tr.setSelection(TextSelection.create(tr.doc, 2)));

    expect(counted.calls).toEqual([]);
  });
});
