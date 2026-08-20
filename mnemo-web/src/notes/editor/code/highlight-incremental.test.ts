// @vitest-environment node

/**
 * That rebuilding part of the highlight set gives the same set as rebuilding all
 * of it.
 *
 * The plugin used to answer every change by building a fresh `DecorationSet`
 * over the whole document, which is obviously correct and, on a code-heavy note,
 * obviously too slow: the set is the size of the note and gets rebuilt per
 * keystroke. It now maps what it has and rebuilds only the blocks a change
 * touched, and the only thing worth asserting about that is the thing it could
 * silently get wrong: that the answer did not change.
 *
 * So the oracle is the old implementation. Every edit here is applied to a real
 * `EditorState` carrying the real plugin, and the set the plugin arrives at is
 * compared against `codeHighlightDecorations` over the resulting document, which
 * is the whole-document build the plugin no longer performs. Same decorations,
 * same positions, same specs, or the incremental path is wrong.
 *
 * The edits are drawn from a seeded generator rather than listed, because the
 * failures this guards against live in sequences, an edit that moves a block
 * followed by one that rewrites it, not in single steps. Seeds are fixed, so a
 * failure is reproducible from the test name.
 */

import { describe, expect, it } from 'vitest';
import { EditorState, Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import { DecorationSet, type Decoration } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../schema';
import { changedRanges } from '../pipeline/invariants';
import { codeHighlightDecorations, codeHighlightPlugin } from './highlight';

const { schema } = createEditorSchema();

const languages = ['typescript', 'sql', 'python', 'csharp', 'json', 'text'] as const;

/** Snippets picked to move token boundaries, not just to lengthen a line. */
const insertions = [
  'const ',
  'select ',
  '"',
  "'",
  '/*',
  '*/',
  '// ',
  '42',
  'x',
  '(',
  ');',
  '\nlet z = 3;',
] as const;

function codeLine(source: string): PMNode {
  return schema.nodes.codeLine.create(null, source.length > 0 ? schema.text(source) : null);
}

function codeBlock(source: string, language = 'typescript'): PMNode {
  return schema.nodes.codeBlock.create({ language }, codeLine(source));
}

function paragraph(text: string): PMNode {
  return schema.nodes.paragraph.create(null, schema.nodes.line.create(null, schema.text(text)));
}

function docWith(blocks: PMNode[]): PMNode {
  return schema.nodes.doc.create(null, blocks);
}

/**
 * A two-column block with a code block down one side.
 *
 * Code is not only ever a top-level block, and the rebuild widens to top-level
 * blocks, so a nested one has to come out of a partial rebuild the same as a
 * bare one does.
 */
function twoColumnWithCode(source: string, language: string): PMNode {
  const column = (child: PMNode): PMNode =>
    schema.nodes.columnGroup.create(null, [schema.nodes.line.create(null), child]);
  return schema.nodes.twoColumn.create(null, [
    schema.nodes.line.create(null),
    column(codeBlock(source, language)),
    column(paragraph('beside the code')),
  ]);
}

/** The class an inline decoration carries. `type` is internal, hence the cast. */
const classOf = (deco: Decoration): string =>
  (deco as unknown as { type: { attrs: { class: string } } }).type.attrs.class;

/**
 * A decoration set as a comparable value: what is decorated, where, and with
 * what. Sorted, because set equality is not about the order a set was built in.
 */
function normalize(decos: readonly Decoration[]): string[] {
  return decos.map((deco) => `${String(deco.from)}-${String(deco.to)}:${classOf(deco)}`).sort();
}

/** What the whole-document build says, which is what the incremental one must match. */
function fromScratch(doc: PMNode): string[] {
  return normalize(codeHighlightDecorations(doc));
}

/** Deterministic, so a seed names a sequence and a failure repeats. */
function rngFor(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length) % items.length];
}

interface Located {
  readonly pos: number;
  readonly node: PMNode;
}

function nodesNamed(doc: PMNode, name: string): Located[] {
  const found: Located[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === name) {
      found.push({ pos, node });
      return false;
    }
    return true;
  });
  return found;
}

/** Every top-level block with its absolute bounds. */
function topLevel(doc: PMNode): { from: number; to: number; node: PMNode }[] {
  const out: { from: number; to: number; node: PMNode }[] = [];
  let offset = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    out.push({ from: offset, to: offset + child.nodeSize, node: child });
    offset += child.nodeSize;
  }
  return out;
}

type Build = (state: EditorState, rng: () => number) => Transaction | null;

/**
 * The edit kinds, each returning null when the document has nothing to apply it
 * to, so a sequence that deleted every code block simply skips the ones that
 * need one.
 */
const edits: Readonly<Record<string, Build>> = {
  typeInsideCode(state, rng) {
    const blocks = nodesNamed(state.doc, 'codeBlock');
    if (blocks.length === 0) return null;
    const block = pick(blocks, rng);
    const start = block.pos + 2;
    const end = block.pos + block.node.nodeSize - 2;
    const at = start + Math.floor(rng() * (end - start + 1));
    return state.tr.insertText(pick(insertions, rng), at);
  },

  typeOutsideCode(state, rng) {
    const lines = nodesNamed(state.doc, 'line');
    if (lines.length === 0) return null;
    const line = pick(lines, rng);
    const at = line.pos + 1 + Math.floor(rng() * (line.node.content.size + 1));
    return state.tr.insertText(pick(insertions, rng), at);
  },

  changeLanguage(state, rng) {
    const blocks = nodesNamed(state.doc, 'codeBlock');
    if (blocks.length === 0) return null;
    const block = pick(blocks, rng);
    const language = pick(languages, rng);
    return state.tr.setNodeMarkup(block.pos, undefined, { ...block.node.attrs, language });
  },

  insertCodeBlock(state, rng) {
    const blocks = topLevel(state.doc);
    const at = rng() < 0.5 ? 0 : pick(blocks, rng).to;
    return state.tr.insert(at, codeBlock(`let n${String(blocks.length)} = 7;`, pick(languages, rng)));
  },

  insertNestedCodeBlock(state, rng) {
    const blocks = topLevel(state.doc);
    const at = rng() < 0.5 ? 0 : pick(blocks, rng).to;
    return state.tr.insert(at, twoColumnWithCode('const nested = "x";', pick(languages, rng)));
  },

  deleteCodeBlock(state, rng) {
    const blocks = topLevel(state.doc).filter((each) => each.node.type.name === 'codeBlock');
    // The schema wants at least one block, and a document of one block has
    // nothing interesting left to say about ranges anyway.
    if (blocks.length === 0 || state.doc.childCount < 2) return null;
    const block = pick(blocks, rng);
    return state.tr.delete(block.from, block.to);
  },

  replaceAcrossBlocks(state, rng) {
    const blocks = topLevel(state.doc);
    if (blocks.length < 2) return null;
    const first = Math.floor(rng() * (blocks.length - 1));
    const last = Math.min(blocks.length - 1, first + 1 + Math.floor(rng() * 2));
    return state.tr.replaceWith(blocks[first].from, blocks[last].to, [
      paragraph('replaced prose'),
      codeBlock('select id from t where x = 1;', pick(languages, rng)),
    ]);
  },

  joinTwoCodeBlocks(state, rng) {
    const blocks = topLevel(state.doc);
    const boundaries: number[] = [];
    for (let i = 0; i + 1 < blocks.length; i++) {
      if (blocks[i].node.type.name === 'codeBlock' && blocks[i + 1].node.type.name === 'codeBlock') {
        boundaries.push(blocks[i].to);
      }
    }
    if (boundaries.length === 0) return null;
    // The transaction a backspace at the head of a code block makes: the
    // boundary between two blocks goes, and the surviving block holds text that
    // was never tokenized as one string before.
    return state.tr.join(pick(boundaries, rng), 2);
  },
};

const editNames = Object.keys(edits);

/** The document every sequence starts from: prose, code, and two adjacent code blocks. */
function startingDoc(): PMNode {
  return docWith([
    paragraph('a note about some code'),
    codeBlock('const answer = 42;', 'typescript'),
    paragraph('and a line between'),
    codeBlock('select id from t;', 'sql'),
    codeBlock("print('hello')", 'python'),
    paragraph('trailing prose'),
    codeBlock('{ "a": 1 }', 'json'),
    twoColumnWithCode('let inner = 5;', 'typescript'),
  ]);
}

function stateWith(plugin: Plugin<DecorationSet>): EditorState {
  return EditorState.create({ schema, doc: startingDoc(), plugins: [plugin] });
}

describe('the incremental highlight set', () => {
  it('starts from a document whose code is both top level and nested', () => {
    // Otherwise the sequences below would prove nothing about nesting, which is
    // the case the top-level widening has to reach through.
    const doc = startingDoc();
    const last = topLevel(doc)[doc.childCount - 1];
    expect(last.node.type.name).toBe('twoColumn');
    expect(
      codeHighlightDecorations(doc).filter((deco) => deco.from > last.from && deco.to < last.to),
    ).not.toEqual([]);
  });

  it('matches a whole-document rebuild after every edit in a random sequence', () => {
    const applied = new Map<string, number>(editNames.map((name) => [name, 0]));

    for (const seed of [1, 7, 19, 101, 4126]) {
      const plugin = codeHighlightPlugin();
      let state = stateWith(plugin);
      const rng = rngFor(seed);

      expect(normalize(plugin.getState(state)?.find() ?? [])).toEqual(fromScratch(state.doc));

      for (let step = 0; step < 60; step++) {
        const name = pick(editNames, rng);
        const tr = edits[name](state, rng);
        if (!tr?.docChanged) continue;
        state = state.apply(tr);
        applied.set(name, (applied.get(name) ?? 0) + 1);

        expect(
          normalize(plugin.getState(state)?.find() ?? []),
          `seed ${String(seed)}, step ${String(step)}, edit ${name}`,
        ).toEqual(fromScratch(state.doc));
      }
    }

    // Coverage, asserted rather than assumed: a sequence that happened to skip
    // an edit kind would still pass every assertion above and prove nothing
    // about that kind.
    for (const name of editNames) {
      expect(applied.get(name) ?? 0, `${name} never ran`).toBeGreaterThan(0);
    }
  });

  it('re-tokenizes a code block that a join gave new text', () => {
    // The case a range-local rebuild is most likely to miss: joining two blocks
    // deletes the boundary and reports an empty range where it used to be, so a
    // rebuild that asked only for blocks the range overlaps would rebuild
    // nothing, and the surviving block would keep colours computed for text it
    // no longer holds.
    const plugin = codeHighlightPlugin();
    let state = EditorState.create({
      schema,
      doc: docWith([codeBlock('/* hidden', 'typescript'), codeBlock('*/ const x = 1;', 'typescript')]),
      plugins: [plugin],
    });
    const boundary = state.doc.child(0).nodeSize;

    state = state.apply(state.tr.join(boundary, 2));

    expect(state.doc.childCount).toBe(1);
    expect(state.doc.child(0).textContent).toBe('/* hidden*/ const x = 1;');
    expect(normalize(plugin.getState(state)?.find() ?? [])).toEqual(fromScratch(state.doc));
    // And the answer really is different from what the two blocks had, so the
    // assertion above is not satisfied by simply carrying the old set forward.
    expect(fromScratch(state.doc)).not.toEqual(
      normalize(codeHighlightDecorations(docWith([codeBlock('/* hidden'), codeBlock('*/ const x = 1;')]))),
    );
  });

  it('shifts an untouched block rather than rebuilding it', () => {
    const plugin = codeHighlightPlugin();
    let state = stateWith(plugin);
    const firstBlock = state.doc.child(0).nodeSize;
    const before = plugin.getState(state)?.find(firstBlock) ?? [];
    expect(before.length).toBeGreaterThan(0);

    // Prose typed into the first block, which moves every code block after it.
    state = state.apply(state.tr.insertText('xyz', 2));

    const after = plugin.getState(state)?.find(firstBlock + 3) ?? [];
    expect(after.map((deco) => deco.from)).toEqual(before.map((deco) => deco.from + 3));
    expect(normalize(plugin.getState(state)?.find() ?? [])).toEqual(fromScratch(state.doc));
  });
});

interface BrokenOptions {
  /**
   * Whether a changed range is grown to the whole blocks it covers before
   * anything is rebuilt. Off is the obvious reading of "rebuild what changed",
   * and it rebuilds a fragment of a code block rather than the block.
   */
  readonly widen: boolean;
  /** Whether what a rebuilt span replaces is taken out first. Off leaves duplicates. */
  readonly dropStale: boolean;
}

/**
 * A configurable incremental plugin, for showing that the comparison above can
 * fail.
 *
 * With both switches on it is the real plugin's shape, which is the control: the
 * comparison has to pass for it, or a divergence would say nothing about the
 * switch that was flipped. Turning either off is a mistake this design invites,
 * and each has to be caught.
 */
function brokenHighlightPlugin(options: BrokenOptions): Plugin<DecorationSet> {
  const key = new PluginKey<DecorationSet>('test-broken-highlight');

  const spansOf = (doc: PMNode, tr: Transaction): { from: number; to: number }[] => {
    const ranges = changedRanges([tr]);
    if (!options.widen) return ranges.map((range) => ({ from: range.from, to: range.to }));
    const spans: { from: number; to: number }[] = [];
    let offset = 0;
    for (let i = 0; i < doc.childCount; i++) {
      const end = offset + doc.child(i).nodeSize;
      if (ranges.some((range) => end >= range.from && offset <= range.to)) {
        spans.push({ from: offset, to: end });
      }
      offset = end;
    }
    return spans;
  };

  return new Plugin<DecorationSet>({
    key,
    state: {
      init: (_config, state) => DecorationSet.create(state.doc, codeHighlightDecorations(state.doc)),
      apply(tr, old, _oldState, newState) {
        if (!tr.docChanged) return old;
        let next = old.map(tr.mapping, newState.doc);
        for (const span of spansOf(newState.doc, tr)) {
          if (options.dropStale) {
            next = next.remove(
              next
                .find(span.from, span.to)
                .filter((deco) => deco.to > span.from && deco.from < span.to),
            );
          }
          next = next.add(
            newState.doc,
            // Filtering the whole-document build to the span is the same set the
            // real plugin computes for it, so only the span rule and the removal
            // differ from the real thing.
            codeHighlightDecorations(newState.doc).filter(
              (deco) => deco.from >= span.from && deco.to <= span.to,
            ),
          );
        }
        return next;
      },
    },
  });
}

/**
 * One keystroke, typed into the middle of a token rather than beside one.
 *
 * `42` becomes `492`, so the decoration that has to come out of this reaches
 * past the single position the transaction reports as changed. That is the
 * ordinary case, and it is the one both mistakes below get wrong.
 */
function typeInsideAToken(plugin: Plugin<DecorationSet>): EditorState {
  const state = stateWith(plugin);
  const block = nodesNamed(state.doc, 'codeBlock')[0];
  const at = block.node.textContent.indexOf('42') + 1;
  expect(at).toBeGreaterThan(0);
  return state.apply(state.tr.insertText('9', block.pos + 2 + at));
}

describe('the comparison itself', () => {
  it('passes for a correctly built incremental plugin, which is the control', () => {
    const plugin = brokenHighlightPlugin({ widen: true, dropStale: true });
    const state = typeInsideAToken(plugin);
    expect(state.doc.child(1).textContent).toBe('const answer = 492;');
    expect(normalize(plugin.getState(state)?.find() ?? [])).toEqual(fromScratch(state.doc));
  });

  it('fails against one that rebuilds the changed range instead of the blocks it covers', () => {
    // It takes out the number's decoration, which overlaps the range, and adds
    // back only what fits inside the range, which is nothing. The number loses
    // its colour and stays uncoloured until something rebuilds the block.
    const plugin = brokenHighlightPlugin({ widen: false, dropStale: true });
    const state = typeInsideAToken(plugin);
    expect(normalize(plugin.getState(state)?.find() ?? [])).not.toEqual(fromScratch(state.doc));
  });

  it('fails against one that adds a rebuilt span without dropping what it replaces', () => {
    // The mistake with no visible symptom: decorations end up present twice,
    // over the same characters and with the same class, so the note looks right
    // while the set grows every time the block is edited.
    const plugin = brokenHighlightPlugin({ widen: true, dropStale: false });
    const state = typeInsideAToken(plugin);
    expect(normalize(plugin.getState(state)?.find() ?? [])).not.toEqual(fromScratch(state.doc));
  });
});
