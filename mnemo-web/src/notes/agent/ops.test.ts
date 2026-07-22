import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { createEditorSchema } from '../editor/schema';
import { createDocumentMapper } from '../editor/mapper/document';
import { createInlineMapper } from '../editor/mapper/inline';
import { walkBlocks } from '../editor/projection/document';
import { defaultTextStyle, type Block, type InlineSpan } from '../model/types';
import { isWellFormedBlockSid } from '../model/sid';
import { compileOps, type CompileDeps } from './ops';
import { renderOutline } from './outline';
import type { NoteOp } from './types';

const { schema, registry } = createEditorSchema();
const mapper = createDocumentMapper(schema, registry);
const inline = createInlineMapper(registry.marks, registry.inlines);

/**
 * A stand-in inline parser: plain text only.
 *
 * The compiler requires a parser rather than defaulting to one, so these tests
 * supply the simplest total implementation. Markdown parsing is a separate
 * concern with its own tests; nothing here depends on it.
 */
const plainParse = (md: string): InlineSpan[] => [
  { kind: 'text', text: md, style: { ...defaultTextStyle } },
];

const deps: CompileDeps = { schema, registry, mapper, inline, parseInline: plainParse };

let counter = 0;
function blockOf(over: Partial<Block> = {}): Block {
  counter += 1;
  return {
    id: `id-${String(counter)}`,
    sid: `s${String(counter).padStart(4, '0')}`,
    type: 'Text',
    spans: [{ kind: 'text', text: '', style: { ...defaultTextStyle } }],
    payload: { kind: 'empty' },
    meta: {},
    order: 0,
    children: null,
    ...over,
  };
}

const text = (t: string): InlineSpan => ({ kind: 'text', text: t, style: { ...defaultTextStyle } });

function stateOf(blocks: readonly Block[]): EditorState {
  const result = mapper.toDoc(blocks);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  return EditorState.create({ doc: result.doc, schema });
}

/** Compiles and applies, returning the resulting blocks. */
function run(blocks: readonly Block[], ops: NoteOp[]): Block[] {
  const state = stateOf(blocks);
  const result = compileOps(state, ops, deps);
  if (!result.ok) throw new Error(result.error.message);
  const next = state.apply(result.tr);
  // Every batch must leave a document the schema still accepts.
  next.doc.check();
  return mapper.fromDoc(next.doc);
}

function expectFailure(blocks: readonly Block[], ops: NoteOp[]) {
  const result = compileOps(stateOf(blocks), ops, deps);
  if (result.ok) throw new Error('expected the batch to fail');
  return result.error;
}

const textsOf = (blocks: readonly Block[]) =>
  blocks.map((b) => b.spans.map((s) => (s.kind === 'text' ? s.text : '')).join(''));

// ---------------------------------------------------------------------------

describe('batch semantics', () => {
  it('rejects an empty batch', () => {
    expect(expectFailure([blockOf()], []).message).toContain('non-empty');
  });

  it('accumulates every op into one transaction', () => {
    const state = stateOf([blockOf({ sid: 'aaaaa', spans: [text('one')] })]);
    const result = compileOps(
      state,
      [
        { op: 'set', id: 'aaaaa', md: 'changed' },
        { op: 'add', where: 'end', blocks: [{ t: 'p', md: 'added' }] },
      ],
      deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // One transaction is what gives the batch one undo entry and one preview.
    expect(result.tr.steps.length).toBeGreaterThan(1);
    expect(result.diff).toHaveLength(2);
  });

  it('applies nothing when a later op fails', () => {
    const blocks = [blockOf({ sid: 'aaaaa', spans: [text('original')] })];
    const state = stateOf(blocks);
    const result = compileOps(
      state,
      [
        { op: 'set', id: 'aaaaa', md: 'changed' },
        { op: 'set', id: 'nope1', md: 'never' },
      ],
      deps,
    );
    expect(result.ok).toBe(false);
    // The caller never receives a transaction, so the first op cannot land.
    expect(mapper.fromDoc(state.doc)[0].spans[0]).toMatchObject({ text: 'original' });
  });

  it('reports which op failed, in the C# failure format', () => {
    const error = expectFailure(
      [blockOf({ sid: 'aaaaa' })],
      [
        { op: 'set', id: 'aaaaa', md: 'fine' },
        { op: 'del', ids: ['zzzzz'] },
      ],
    );
    expect(error.opIndex).toBe(1);
    expect(error.message).toBe('op[1] (del): no block matching "zzzzz".');
  });

  it('rejects an unknown op name', () => {
    const error = expectFailure([blockOf()], [{ op: 'convert', id: 'a' } as unknown as NoteOp]);
    expect(error.code).toBe('validation_error');
    expect(error.message).toContain('unknown op "convert"');
  });
});

describe('set', () => {
  it('replaces a blockentire inline content', () => {
    const out = run([blockOf({ sid: 'aaaaa', spans: [text('before')] })], [
      { op: 'set', id: 'aaaaa', md: 'after' },
    ]);
    expect(textsOf(out)).toEqual(['after']);
  });

  it('keeps the block id and sid', () => {
    const out = run([blockOf({ sid: 'aaaaa', id: 'keep-me', spans: [text('x')] })], [
      { op: 'set', id: 'aaaaa', md: 'y' },
    ]);
    expect(out[0]).toMatchObject({ sid: 'aaaaa', id: 'keep-me' });
  });

  it('resolves a block by unique sid prefix', () => {
    const out = run([blockOf({ sid: 'k7m2q', spans: [text('x')] })], [
      { op: 'set', id: 'k7', md: 'y' },
    ]);
    expect(textsOf(out)).toEqual(['y']);
  });

  it('rejects an ambiguous prefix with candidates', () => {
    const error = expectFailure(
      [blockOf({ sid: 'k7m2q' }), blockOf({ sid: 'k7xyz' })],
      [{ op: 'set', id: 'k7', md: 'y' }],
    );
    expect(error.code).toBe('validation_error');
    expect(error.candidates).toEqual(['k7m2q', 'k7xyz']);
  });
});

describe('edit', () => {
  it('replaces only the found text', () => {
    const out = run([blockOf({ sid: 'aaaaa', spans: [text('the quick brown fox')] })], [
      { op: 'edit', id: 'aaaaa', find: 'quick', md: 'slow' },
    ]);
    expect(textsOf(out)).toEqual(['the slow brown fox']);
  });

  it('rejects a find with no match', () => {
    const error = expectFailure([blockOf({ sid: 'aaaaa', spans: [text('hello')] })], [
      { op: 'edit', id: 'aaaaa', find: 'absent', md: 'x' },
    ]);
    expect(error.code).toBe('not_found');
    expect(error.message).toContain('no match for "absent"');
  });

  it('rejects an ambiguous find rather than picking the first', () => {
    // Silently taking the first occurrence gives a model no way to notice it
    // edited the wrong one.
    const error = expectFailure([blockOf({ sid: 'aaaaa', spans: [text('a cat and a cat')] })], [
      { op: 'edit', id: 'aaaaa', find: 'cat', md: 'dog' },
    ]);
    expect(error.code).toBe('validation_error');
    expect(error.message).toContain('matches 2 times');
  });

  it('locates text sitting after an inline atom', () => {
    // The reason `find` goes through the block's own projection rather than
    // adding offsets: an equation projects as its whole LaTeX source but
    // occupies exactly one ProseMirror position, so the two coordinate spaces
    // drift apart the moment a block contains one. Raw offsets land inside the
    // atom and corrupt the block.
    const equation: InlineSpan = { kind: 'equation', latex: 'x^{2}+y^{2}', style: { ...defaultTextStyle } };
    const out = run([blockOf({ sid: 'aaaaa', spans: [equation, text(' equals target')] })], [
      { op: 'edit', id: 'aaaaa', find: 'target', md: 'result' },
    ]);
    expect(out[0].spans[0]).toMatchObject({ kind: 'equation', latex: 'x^{2}+y^{2}' });
    expect(textsOf(out)).toEqual([' equals result']);
  });

  it('formats text sitting after an inline atom', () => {
    const equation: InlineSpan = { kind: 'equation', latex: 'a^{2}', style: { ...defaultTextStyle } };
    const out = run([blockOf({ sid: 'aaaaa', spans: [equation, text(' see this')] })], [
      { op: 'fmt', id: 'aaaaa', find: 'this', mark: 'b', on: true },
    ]);
    const bolded = out[0].spans.filter((s) => s.kind === 'text' && s.style.bold);
    expect(bolded.map((s) => (s.kind === 'text' ? s.text : ''))).toEqual(['this']);
    expect(out[0].spans[0]).toMatchObject({ kind: 'equation' });
  });

  it('requires a find', () => {
    expect(
      expectFailure([blockOf({ sid: 'aaaaa' })], [{ op: 'edit', id: 'aaaaa', find: '', md: 'x' }])
        .message,
    ).toContain('find is required');
  });
});

describe('fmt', () => {
  it('applies a mark over the found range only', () => {
    const out = run([blockOf({ sid: 'aaaaa', spans: [text('plain bold plain')] })], [
      { op: 'fmt', id: 'aaaaa', find: 'bold', mark: 'b', on: true },
    ]);
    const bolded = out[0].spans.filter((s) => s.kind === 'text' && s.style.bold);
    expect(bolded.map((s) => (s.kind === 'text' ? s.text : ''))).toEqual(['bold']);
  });

  it('removes a mark', () => {
    const styled: InlineSpan = {
      kind: 'text',
      text: 'bold',
      style: { ...defaultTextStyle, bold: true },
    };
    const out = run([blockOf({ sid: 'aaaaa', spans: [styled] })], [
      { op: 'fmt', id: 'aaaaa', find: 'bold', mark: 'b', on: false },
    ]);
    expect(out[0].spans[0].style.bold).toBe(false);
  });

  it('does not change the text', () => {
    const out = run([blockOf({ sid: 'aaaaa', spans: [text('inner product')] })], [
      { op: 'fmt', id: 'aaaaa', find: 'inner', mark: 'i', on: true },
    ]);
    expect(textsOf(out)).toEqual(['inner product']);
  });

  it('rejects an unknown mark', () => {
    const error = expectFailure([blockOf({ sid: 'aaaaa', spans: [text('x')] })], [
      { op: 'fmt', id: 'aaaaa', find: 'x', mark: 'blink', on: true },
    ]);
    expect(error.message).toContain('unknown mark "blink"');
  });

  it('refuses to format a source block instead of silently dropping the mark', () => {
    // `codeLine` forbids marks structurally, so the step would vanish and the
    // model would believe the formatting applied.
    const error = expectFailure(
      [
        blockOf({
          sid: 'aaaaa',
          type: 'Code',
          spans: [text('let x = 1')],
          payload: { kind: 'code', language: 'ts', source: 'let x = 1' },
        }),
      ],
      [{ op: 'fmt', id: 'aaaaa', find: 'let', mark: 'b', on: true }],
    );
    expect(error.message).toContain('source block');
  });
});

describe('add', () => {
  it('inserts after an anchor', () => {
    const out = run(
      [blockOf({ sid: 'aaaaa', spans: [text('one')] }), blockOf({ sid: 'bbbbb', spans: [text('two')] })],
      [{ op: 'add', at: 'aaaaa', where: 'after', blocks: [{ t: 'p', md: 'inserted' }] }],
    );
    expect(textsOf(out)).toEqual(['one', 'inserted', 'two']);
  });

  it('inserts before an anchor', () => {
    const out = run([blockOf({ sid: 'aaaaa', spans: [text('one')] })], [
      { op: 'add', at: 'aaaaa', where: 'before', blocks: [{ t: 'p', md: 'first' }] },
    ]);
    expect(textsOf(out)).toEqual(['first', 'one']);
  });

  it('inserts at the document start and end', () => {
    const base = [blockOf({ sid: 'aaaaa', spans: [text('mid')] })];
    expect(textsOf(run(base, [{ op: 'add', where: 'start', blocks: [{ md: 'top' }] }]))).toEqual([
      'top',
      'mid',
    ]);
    expect(textsOf(run(base, [{ op: 'add', where: 'end', blocks: [{ md: 'bottom' }] }]))).toEqual([
      'mid',
      'bottom',
    ]);
  });

  it('inserts several blocks as one contiguous run, in order', () => {
    const out = run([blockOf({ sid: 'aaaaa', spans: [text('one')] })], [
      { op: 'add', at: 'aaaaa', where: 'after', blocks: [{ md: 'a' }, { md: 'b' }, { md: 'c' }] },
    ]);
    expect(textsOf(out)).toEqual(['one', 'a', 'b', 'c']);
  });

  it('mints a unique well-formed sid for every added block', () => {
    const out = run([blockOf({ sid: 'aaaaa' })], [
      { op: 'add', where: 'end', blocks: [{ md: 'a' }, { md: 'b' }] },
    ]);
    const sids = out.map((b) => b.sid);
    expect(new Set(sids).size).toBe(sids.length);
    for (const sid of sids.slice(1)) expect(isWellFormedBlockSid(sid)).toBe(true);
  });

  it('creates each supported type with its payload', () => {
    const out = run([blockOf({ sid: 'aaaaa' })], [
      {
        op: 'add',
        where: 'end',
        blocks: [
          { t: 'td', md: 'task', checked: true },
          { t: 'c', md: 'code()', lang: 'ts' },
          { t: 'h2', md: 'Section' },
        ],
      },
    ]);
    expect(out[1]).toMatchObject({ type: 'Checklist', payload: { kind: 'checklist', checked: true } });
    expect(out[2]).toMatchObject({ type: 'Code', payload: { kind: 'code', language: 'ts' } });
    expect(out[3].type).toBe('Heading2');
  });

  it('adds into a container with where: in', () => {
    const out = run(
      [
        blockOf({
          sid: 'twoxx',
          type: 'TwoColumn',
          payload: { kind: 'twoColumn', splitRatio: 0.5 },
          children: [blockOf({ sid: 'leftx', type: 'ColumnGroup' }), blockOf({ sid: 'right', type: 'ColumnGroup' })],
        }),
      ],
      [{ op: 'add', at: 'leftx', where: 'in', blocks: [{ md: 'in the left column' }] }],
    );
    const left = out[0].children?.[0];
    expect(textsOf(left?.children ?? [])).toEqual(['in the left column']);
  });

  it('rejects where: in when the content expression forbids it', () => {
    // A two-column block is `line columnGroup columnGroup`, it holds cells,
    // not arbitrary blocks. Asking the content expression is what makes this
    // exact rather than a guess about which types are containers.
    const error = expectFailure(
      [
        blockOf({
          sid: 'twoxx',
          type: 'TwoColumn',
          payload: { kind: 'twoColumn', splitRatio: 0.5 },
          children: [blockOf({ sid: 'leftx', type: 'ColumnGroup' }), blockOf({ sid: 'right', type: 'ColumnGroup' })],
        }),
      ],
      [{ op: 'add', at: 'twoxx', where: 'in', blocks: [{ md: 'x' }] }],
    );
    expect(error.message).toContain('cannot contain these blocks');
  });

  it('rejects an anchored where with no anchor, rather than defaulting to the end', () => {
    // The C# service coerces this to "append at the top level", which turns a
    // model's mistake into a block appearing somewhere it did not ask for.
    expect(
      expectFailure([blockOf({ sid: 'aaaaa' })], [{ op: 'add', where: 'after', blocks: [{ md: 'x' }] }])
        .message,
    ).toContain('needs an anchor');
  });

  it('rejects a document-level where that carries an anchor', () => {
    expect(
      expectFailure(
        [blockOf({ sid: 'aaaaa' })],
        [{ op: 'add', at: 'aaaaa', where: 'end', blocks: [{ md: 'x' }] }],
      ).message,
    ).toContain('takes no anchor');
  });

  it('rejects an empty blocks array', () => {
    expect(
      expectFailure([blockOf({ sid: 'aaaaa' })], [{ op: 'add', where: 'end', blocks: [] }]).message,
    ).toContain('no content');
  });

  it('rejects creating a column container directly', () => {
    // There is no `children` field in the op vocabulary, so a two-column block
    // built here could never get its two mandatory cells.
    expect(
      expectFailure([blockOf({ sid: 'aaaaa' })], [{ op: 'add', where: 'end', blocks: [{ t: '2c' }] }])
        .message,
    ).toContain('cannot be created directly');
  });

  it('rejects an unknown type code', () => {
    expect(
      expectFailure([blockOf({ sid: 'aaaaa' })], [{ op: 'add', where: 'end', blocks: [{ t: 'zz' }] }])
        .message,
    ).toContain('unknown type "zz"');
  });
});

describe('del', () => {
  it('deletes one block', () => {
    const out = run(
      [blockOf({ sid: 'aaaaa', spans: [text('one')] }), blockOf({ sid: 'bbbbb', spans: [text('two')] })],
      [{ op: 'del', ids: ['aaaaa'] }],
    );
    expect(textsOf(out)).toEqual(['two']);
  });

  it('deletes several blocks regardless of the order they are named in', () => {
    // Each id re-resolves against the document as it stands, so index shifts
    // from earlier deletions take care of themselves.
    const blocks = [
      blockOf({ sid: 'aaaaa', spans: [text('one')] }),
      blockOf({ sid: 'bbbbb', spans: [text('two')] }),
      blockOf({ sid: 'ccccc', spans: [text('three')] }),
    ];
    expect(textsOf(run(blocks, [{ op: 'del', ids: ['aaaaa', 'ccccc'] }]))).toEqual(['two']);
    expect(textsOf(run(blocks, [{ op: 'del', ids: ['ccccc', 'aaaaa'] }]))).toEqual(['two']);
  });

  it('deletes a block children with it', () => {
    const out = run(
      [
        blockOf({
          sid: 'twoxx',
          type: 'TwoColumn',
          payload: { kind: 'twoColumn', splitRatio: 0.5 },
          children: [blockOf({ sid: 'leftx', type: 'ColumnGroup' }), blockOf({ sid: 'right', type: 'ColumnGroup' })],
        }),
        blockOf({ sid: 'after', spans: [text('kept')] }),
      ],
      [{ op: 'del', ids: ['twoxx'] }],
    );
    expect(textsOf(out)).toEqual(['kept']);
  });

  it('rejects an empty ids list', () => {
    expect(expectFailure([blockOf({ sid: 'aaaaa' })], [{ op: 'del', ids: [] }]).message).toContain(
      'requires ids',
    );
  });
});

describe('move', () => {
  it('moves a block after an anchor', () => {
    const out = run(
      [
        blockOf({ sid: 'aaaaa', spans: [text('one')] }),
        blockOf({ sid: 'bbbbb', spans: [text('two')] }),
        blockOf({ sid: 'ccccc', spans: [text('three')] }),
      ],
      [{ op: 'move', id: 'aaaaa', at: 'ccccc', where: 'after' }],
    );
    expect(textsOf(out)).toEqual(['two', 'three', 'one']);
  });

  it('moves a block before an anchor', () => {
    const out = run(
      [
        blockOf({ sid: 'aaaaa', spans: [text('one')] }),
        blockOf({ sid: 'bbbbb', spans: [text('two')] }),
        blockOf({ sid: 'ccccc', spans: [text('three')] }),
      ],
      [{ op: 'move', id: 'ccccc', at: 'aaaaa', where: 'before' }],
    );
    expect(textsOf(out)).toEqual(['three', 'one', 'two']);
  });

  it('moves a block into a container', () => {
    const out = run(
      [
        blockOf({ sid: 'loose', spans: [text('moved')] }),
        blockOf({
          sid: 'twoxx',
          type: 'TwoColumn',
          payload: { kind: 'twoColumn', splitRatio: 0.5 },
          children: [blockOf({ sid: 'leftx', type: 'ColumnGroup' }), blockOf({ sid: 'right', type: 'ColumnGroup' })],
        }),
      ],
      [{ op: 'move', id: 'loose', at: 'leftx', where: 'in' }],
    );
    expect(out).toHaveLength(1);
    expect(textsOf(out[0].children?.[0].children ?? [])).toEqual(['moved']);
  });

  it('keeps the moved block sid and content', () => {
    const out = run(
      [blockOf({ sid: 'aaaaa', spans: [text('one')] }), blockOf({ sid: 'bbbbb', spans: [text('two')] })],
      [{ op: 'move', id: 'aaaaa', at: 'bbbbb', where: 'after' }],
    );
    expect(out[1]).toMatchObject({ sid: 'aaaaa' });
    expect(textsOf(out)).toEqual(['two', 'one']);
  });

  it('reports a self-move clearly instead of as a missing block', () => {
    // The C# implementation removes the block before resolving the anchor, so
    // this reports `not_found` for an id that was plainly there.
    const error = expectFailure(
      [blockOf({ sid: 'aaaaa' }), blockOf({ sid: 'bbbbb' })],
      [{ op: 'move', id: 'aaaaa', at: 'aaaaa', where: 'after' }],
    );
    expect(error.code).toBe('validation_error');
    expect(error.message).toContain('cannot move relative to itself');
  });

  it('refuses to move a block inside its own subtree', () => {
    const error = expectFailure(
      [
        blockOf({
          sid: 'twoxx',
          type: 'TwoColumn',
          payload: { kind: 'twoColumn', splitRatio: 0.5 },
          children: [blockOf({ sid: 'leftx', type: 'ColumnGroup' }), blockOf({ sid: 'right', type: 'ColumnGroup' })],
        }),
      ],
      [{ op: 'move', id: 'twoxx', at: 'leftx', where: 'in' }],
    );
    expect(error.message).toContain('cannot move inside itself');
  });

  it('rejects a document-level where', () => {
    expect(
      expectFailure(
        [blockOf({ sid: 'aaaaa' }), blockOf({ sid: 'bbbbb' })],
        [{ op: 'move', id: 'aaaaa', at: 'bbbbb', where: 'end' }],
      ).message,
    ).toContain('before, after or in');
  });
});

describe('type', () => {
  it('converts a paragraph to a heading, keeping the sid', () => {
    const out = run([blockOf({ sid: 'aaaaa', spans: [text('Title')] })], [
      { op: 'type', id: 'aaaaa', to: 'h2' },
    ]);
    expect(out[0]).toMatchObject({ sid: 'aaaaa', type: 'Heading2' });
    expect(textsOf(out)).toEqual(['Title']);
  });

  it('checks a checklist idempotently', () => {
    const once = run([blockOf({ sid: 'aaaaa', spans: [text('task')] })], [
      { op: 'type', id: 'aaaaa', to: 'td', checked: true },
    ]);
    expect(once[0].payload).toMatchObject({ kind: 'checklist', checked: true });

    const twice = run(once, [{ op: 'type', id: 'aaaaa', to: 'td', checked: true }]);
    expect(twice[0].payload).toMatchObject({ kind: 'checklist', checked: true });
  });

  it('keeps checked state when converting a checklist without saying otherwise', () => {
    const blocks = [
      blockOf({ sid: 'aaaaa', type: 'Checklist', payload: { kind: 'checklist', checked: true }, spans: [text('t')] }),
    ];
    const out = run(blocks, [{ op: 'type', id: 'aaaaa', to: 'td' }]);
    expect(out[0].payload).toMatchObject({ checked: true });
  });

  it('gives a converted block the payload its new type requires', () => {
    // The C# `convert` only fixes the checklist payload, so a text block
    // converted to Equation there keeps stale spans and never gets a payload.
    const out = run([blockOf({ sid: 'aaaaa', spans: [text('E = mc^2')] })], [
      { op: 'type', id: 'aaaaa', to: 'eq' },
    ]);
    expect(out[0]).toMatchObject({ type: 'Equation', payload: { kind: 'equation', latex: 'E = mc^2' } });
  });

  it('drops a payload the new type has nowhere to put', () => {
    const blocks = [
      blockOf({
        sid: 'aaaaa',
        type: 'Checklist',
        payload: { kind: 'checklist', checked: true },
        spans: [text('was a task')],
      }),
    ];
    const out = run(blocks, [{ op: 'type', id: 'aaaaa', to: 'p' }]);
    expect(out[0]).toMatchObject({ type: 'Text', payload: { kind: 'empty' } });
  });

  it('converts to a code block with the requested language', () => {
    const out = run([blockOf({ sid: 'aaaaa', spans: [text('print(1)')] })], [
      { op: 'type', id: 'aaaaa', to: 'c', lang: 'python' },
    ]);
    expect(out[0].payload).toMatchObject({ kind: 'code', language: 'python', source: 'print(1)' });
  });

  it('rejects converting to a column container', () => {
    expect(
      expectFailure([blockOf({ sid: 'aaaaa' })], [{ op: 'type', id: 'aaaaa', to: '2c' }]).message,
    ).toContain('cannot convert');
  });

  it('rejects an unknown type code', () => {
    expect(
      expectFailure([blockOf({ sid: 'aaaaa' })], [{ op: 'type', id: 'aaaaa', to: 'zz' }]).message,
    ).toContain('unknown type "zz"');
  });
});

describe('the compiled document', () => {
  it('stays schema-valid after a mixed batch', () => {
    const blocks = [
      blockOf({ sid: 'aaaaa', spans: [text('alpha')] }),
      blockOf({ sid: 'bbbbb', spans: [text('beta')] }),
    ];
    const out = run(blocks, [
      { op: 'add', at: 'aaaaa', where: 'after', blocks: [{ t: 'h1', md: 'Heading' }] },
      { op: 'type', id: 'bbbbb', to: 'td', checked: true },
      { op: 'set', id: 'aaaaa', md: 'replaced' },
      { op: 'move', id: 'bbbbb', at: 'aaaaa', where: 'before' },
    ]);
    // `run` already calls doc.check(); this pins the resulting order.
    expect(textsOf(out)).toEqual(['beta', 'replaced', 'Heading']);
  });

  it('leaves every block addressable in the outline afterwards', () => {
    const state = stateOf([blockOf({ sid: 'aaaaa', spans: [text('one')] })]);
    const result = compileOps(
      state,
      [{ op: 'add', where: 'end', blocks: [{ md: 'two' }, { md: 'three' }] }],
      deps,
    );
    if (!result.ok) throw new Error(result.error.message);
    const next = state.apply(result.tr);
    const lines = renderOutline(next.doc, registry).split('\n');
    expect(lines).toHaveLength(3);
    // Every line must start with a resolvable sid, or the model cannot address
    // what it just created.
    for (const entry of walkBlocks(next.doc, registry)) {
      expect(isWellFormedBlockSid(entry.sid)).toBe(true);
    }
  });

  it('is deterministic apart from minted ids', () => {
    // The safety gate re-resolves a batch at commit and compares it against
    // what the user approved, which only works if compilation is pure.
    const blocks = [blockOf({ sid: 'aaaaa', spans: [text('alpha')] })];
    const ops: NoteOp[] = [{ op: 'set', id: 'aaaaa', md: 'changed' }];
    expect(textsOf(run(blocks, ops))).toEqual(textsOf(run(blocks, ops)));
  });
});
