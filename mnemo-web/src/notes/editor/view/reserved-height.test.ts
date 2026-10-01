// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { block, span, structuralFixtures } from '../mapper/fixtures';
import { splitBlock } from '../commands/structure';
import type { BlockRegistry, HeightEstimator } from '../registry/build';
import type { Block } from '../../model/types';
import { mountEditor, type MountedEditor } from './mount';
import { heightEstimator, NOTE_CONTENT_WIDTH, writeReservedHeight } from './reserved-height';

type Blocks = Parameters<typeof buildNoteEditState>[0][number][];

const mounted: MountedEditor[] = [];

afterEach(() => {
  for (const editor of mounted.splice(0)) {
    const host = editor.view.dom.parentElement;
    editor.destroy();
    host?.remove();
  }
});

interface MountOptions {
  readonly registryFor?: (registry: BlockRegistry) => BlockRegistry;
  readonly reserveHeights?: boolean;
  readonly chunked?: boolean;
}

function mount(blocks: readonly Block[], options: MountOptions = {}) {
  const built = buildNoteEditState(blocks);
  if (!built.ok) throw new Error('fixture did not build');
  const registry = (options.registryFor ?? ((r) => r))(built.registry);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const queue: (() => void)[] = [];
  const editor = mountEditor({
    mount: host,
    state: built.state,
    registry,
    reserveHeights: options.reserveHeights ?? true,
    ...(options.chunked ? { chunkThreshold: 2, firstChunkSize: 1, chunkSize: 1 } : {}),
    schedule: (run) => queue.push(run),
  });
  while (queue.length > 0) queue.shift()!();
  mounted.push(editor);
  return { view: editor.view, registry };
}

function topLevelElements(view: MountedEditor['view']): HTMLElement[] {
  const out: HTMLElement[] = [];
  view.state.doc.forEach((_node, pos) => out.push(view.nodeDOM(pos) as HTMLElement));
  return out;
}

/** The end of the first line whose text is `text`. */
function textEndOf(view: MountedEditor['view'], text: string): number {
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isTextblock && node.textContent === text) at = pos + 1 + node.content.size;
    return at < 0;
  });
  if (at < 0) throw new Error(`no line reads ${text}`);
  return at;
}

function reserved(dom: HTMLElement): string {
  return dom.style.getPropertyValue('contain-intrinsic-size');
}

/** Records which module estimated, so a rebuild's real cost is observable. */
function countingRegistry(calls: string[]): (registry: BlockRegistry) => BlockRegistry {
  return (registry) => {
    const estimators = new Map<string, HeightEstimator>(
      [...registry.estimators].map(([name, estimate]) => [
        name,
        (node, ctx) => {
          calls.push(name);
          return estimate(node, ctx);
        },
      ]),
    );
    return { ...registry, estimators };
  };
}

/** Every block type in a shape real notes hold, plus a wrapping paragraph and a table. */
function everyBlockType(): Block[] {
  const blocks: Block[] = structuralFixtures().flatMap((fixture) => [...fixture.blocks]);
  blocks.push(block('Text', [span('word '.repeat(160))]));
  const cell = (body: string) => block('TableCell', [span(body)]);
  const row = (...cells: Block[]) => block('TableRow', [span('')], { kind: 'empty' }, { children: cells });
  blocks.push(
    block('Table', [span('')], { kind: 'table', columnWidths: [], headerRows: [], headerColumns: [], fullWidth: false }, {
      children: [row(cell('a'), cell('b')), row(cell('c'), cell('d')), row(cell('e'), cell('f'))],
    }),
  );
  return blocks;
}

/**
 * The heights the decoration-based reservation produced for `everyBlockType`. A
 * different number moves the scrollbar of every note that holds that block.
 */
const DECORATION_ERA_HEIGHTS = [
  34, 34, 52, 44, 38, 35, 34, 34, 34, 34, 34, 34, 136, 34, 34, 26, 34, 34, 34, 34, 34, 34, 68, 240, 349, 481,
  243, 268, 204, 712, 164, 34, 64, 32, 68, 102, 34, 34, 34, 34, 34, 34, 34, 34, 268, 118,
];

describe('what gets a reserved height', () => {
  it('reserves exactly what every block type reserved before', () => {
    const { view } = mount(everyBlockType());
    const values = topLevelElements(view).map(reserved);

    expect(values).toEqual(DECORATION_ERA_HEIGHTS.map((h) => `auto ${String(h)}px`));
  });

  it('gives nested blocks nothing, because only top-level blocks are skipped', () => {
    const { view } = mount(everyBlockType());
    const nested = [...view.dom.querySelectorAll<HTMLElement>(':scope > * *')].filter((el) => reserved(el) !== '');

    expect(nested).toEqual([]);
  });

  it('leaves a block with no estimate to the stylesheet rather than reserving zero', () => {
    const withoutParagraph = (registry: BlockRegistry): BlockRegistry => {
      const estimators = new Map(registry.estimators);
      estimators.delete('paragraph');
      return { ...registry, estimators };
    };
    const { view } = mount([block('Heading1', [span('Title')]), block('Text', [span('body')])], {
      registryFor: withoutParagraph,
    });
    const [heading, paragraph] = topLevelElements(view);

    expect(reserved(heading)).not.toBe('');
    expect(reserved(paragraph)).toBe('');
  });

  it('reserves nothing when the mount does not ask for it', () => {
    const { view } = mount(everyBlockType(), { reserveHeights: false });

    expect(topLevelElements(view).filter((el) => reserved(el) !== '')).toEqual([]);
  });

  it('reserves heights on blocks a chunked mount appends later', () => {
    const { view } = mount([block('Text', [span('one')]), block('Text', [span('two')]), block('Heading1', [span('three')])], {
      chunked: true,
    });

    expect(view.state.doc.childCount).toBe(3);
    expect(topLevelElements(view).map(reserved)).toEqual(['auto 34px', 'auto 34px', 'auto 52px']);
  });
});

describe('writing the height', () => {
  it('writes the plain length and then the auto form, and nothing when unchanged', () => {
    const dom = document.createElement('div');
    const writes: string[] = [];
    const setProperty = dom.style.setProperty.bind(dom.style);
    dom.style.setProperty = (name: string, value: string | null) => {
      writes.push(String(value));
      setProperty(name, value);
    };

    expect(writeReservedHeight(dom, 34, 0)).toBe(34);
    expect(writes).toEqual(['34px', 'auto 34px']);
    expect(reserved(dom)).toBe('auto 34px');

    writes.length = 0;
    writeReservedHeight(dom, 34, 34);
    expect(writes).toEqual([]);
  });

  it('removes the property when the estimate falls to zero', () => {
    const dom = document.createElement('div');
    writeReservedHeight(dom, 34, 0);
    writeReservedHeight(dom, 0, 34);

    expect(reserved(dom)).toBe('');
  });
});

describe('keeping heights up to date', () => {
  it('re-estimates only the block a keystroke landed in', () => {
    const calls: string[] = [];
    const { view } = mount([block('Text', [span('one')]), block('Text', [span('two')]), block('Text', [span('three')])], {
      registryFor: countingRegistry(calls),
    });
    calls.length = 0;

    view.dispatch(view.state.tr.insertText('X', 4));

    expect(calls).toEqual(['paragraph']);
    expect(topLevelElements(view).map(reserved)).toEqual(['auto 34px', 'auto 34px', 'auto 34px']);
  });

  it('re-estimates both halves of a split', () => {
    const calls: string[] = [];
    const { view } = mount([block('Text', [span('abcd')])], { registryFor: countingRegistry(calls) });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)));
    calls.length = 0;

    splitBlock(view.state, (tr) => view.dispatch(tr));

    expect(view.state.doc.childCount).toBe(2);
    expect(calls).toEqual(['paragraph', 'paragraph']);
    expect(topLevelElements(view).map(reserved)).toEqual(['auto 34px', 'auto 34px']);
  });

  it('keeps every remaining block and its height when one is deleted', () => {
    const { view } = mount([block('Heading1', [span('one')]), block('Text', [span('two')]), block('Heading2', [span('three')])]);
    const [, second, third] = topLevelElements(view);

    view.dispatch(view.state.tr.delete(0, view.state.doc.child(0).nodeSize));

    const remaining = topLevelElements(view);
    expect(remaining[0]).toBe(second);
    expect(remaining[1]).toBe(third);
    expect(remaining.map(reserved)).toEqual(['auto 34px', 'auto 44px']);
  });

  it('does no work for a transaction that changes no content', () => {
    const calls: string[] = [];
    const { view } = mount([block('Text', [span('one')])], { registryFor: countingRegistry(calls) });
    calls.length = 0;

    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));

    expect(calls).toEqual([]);
  });

  it('reserves the new height when a heading changes level', () => {
    const { view, registry } = mount([block('Heading1', [span('Title')])]);
    const heading = view.state.doc.child(0);

    view.dispatch(view.state.tr.setNodeMarkup(0, undefined, { ...heading.attrs, level: 3 }));

    const estimate = heightEstimator(registry, NOTE_CONTENT_WIDTH);
    const value = reserved(topLevelElements(view)[0]);
    expect(value).toBe(`auto ${String(estimate(view.state.doc.child(0)))}px`);
    expect(value).not.toBe('auto 52px');
  });

  it('re-reserves a two-column when a paragraph in one lane grows', () => {
    const lane = (text: string) => block('ColumnGroup', [span('')], { kind: 'empty' }, { children: [block('Text', [span(text)])] });
    const { view, registry } = mount([block('TwoColumn', [span('')], { kind: 'twoColumn', splitRatio: 0.5 }, { children: [lane('L'), lane('R')] })]);
    const before = reserved(topLevelElements(view)[0]);

    view.dispatch(view.state.tr.insertText(' word'.repeat(400), textEndOf(view, 'L')));

    const estimate = heightEstimator(registry, NOTE_CONTENT_WIDTH);
    const after = reserved(topLevelElements(view)[0]);
    expect(after).not.toBe(before);
    expect(after).toBe(`auto ${String(estimate(view.state.doc.child(0)))}px`);
  });

  it('re-reserves a list item when one of its nested children grows', () => {
    const { view, registry } = mount([
      block('BulletList', [span('parent')], { kind: 'empty' }, { children: [block('BulletList', [span('child')])] }),
    ]);
    const before = reserved(topLevelElements(view)[0]);

    view.dispatch(view.state.tr.insertText(' word'.repeat(400), textEndOf(view, 'child')));

    const estimate = heightEstimator(registry, NOTE_CONTENT_WIDTH);
    const after = reserved(topLevelElements(view)[0]);
    expect(after).not.toBe(before);
    expect(after).toBe(`auto ${String(estimate(view.state.doc.child(0)))}px`);
  });

  it('reserves the heights of a document that replaces the whole state', () => {
    const { view, registry } = mount([block('Text', [span('old')])]);
    const next = buildNoteEditState(everyBlockType());
    if (!next.ok) throw new Error('fixture did not build');

    view.updateState(EditorState.create({ schema: view.state.schema, doc: next.state.doc, plugins: view.state.plugins }));

    const estimate = heightEstimator(registry, NOTE_CONTENT_WIDTH);
    const expected: string[] = [];
    view.state.doc.forEach((child) => expected.push(`auto ${String(estimate(child))}px`));
    expect(topLevelElements(view).map(reserved)).toEqual(expected);
  });

  it('grows a paragraph that starts to wrap', () => {
    const { view } = mount([block('Text', [span('short')])]);

    view.dispatch(view.state.tr.insertText(' word'.repeat(60), 7));

    expect(reserved(topLevelElements(view)[0])).not.toBe('auto 34px');
  });
});

describe('the height each module estimates', () => {
  function heightsOf(blocks: Blocks): number[] {
    const built = buildNoteEditState(blocks);
    if (!built.ok) throw new Error('fixture did not build');
    const estimate = heightEstimator(built.registry, NOTE_CONTENT_WIDTH);
    const out: number[] = [];
    built.state.doc.forEach((child: PMNode) => out.push(estimate(child)));
    return out;
  }

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
    const [short, long] = heightsOf([block('Text', [span('one line')]), block('Text', [span('word '.repeat(200))])]);

    expect(long).toBeGreaterThan(short * 5);
  });

  it('counts source lines for code, which does not wrap', () => {
    const source = 'one\ntwo\nthree';
    const [code] = heightsOf([block('Code', [span(source)], { kind: 'code', language: 'csharp', source })]);
    const [oneLine] = heightsOf([block('Code', [span('one')], { kind: 'code', language: 'csharp', source: 'one' })]);

    expect(code).toBe(oneLine + 2 * 26);
  });

  it('asks a container for its tallest lane, not for its own empty line', () => {
    const tall = Array.from({ length: 4 }, () => block('Text', [span('deep')]));
    const [container] = heightsOf([
      block('TwoColumn', [span('')], { kind: 'twoColumn', splitRatio: 0.5 }, {
        children: [
          block('ColumnGroup', [span('')], { kind: 'empty' }, { children: tall }),
          block('ColumnGroup', [span('')], { kind: 'empty' }, { children: [block('Text', [span('short')])] }),
        ],
      }),
    ]);
    const [singleLine] = heightsOf([block('Text', [span('deep')])]);

    expect(container).toBeGreaterThan(singleLine * 4);
  });
});
