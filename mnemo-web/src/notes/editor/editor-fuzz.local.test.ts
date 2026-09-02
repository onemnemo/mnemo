// @vitest-environment jsdom

/**
 * A randomized, user-like operation fuzzer over the real editor.
 *
 * The state under test is the one the app opens a note with, built through
 * `buildNoteEditState` and mounted through `mountEditor`, so every appended
 * transaction, node view, keymap and history grouping takes part. Operations go
 * in as keys and text input rather than as commands, so the plugin precedence in
 * `editorPlugins` is what decides each outcome.
 *
 * After every operation the document must still satisfy its schema, every block
 * must still carry a unique well formed short id, the selection must resolve,
 * and saving and reopening the note must give back exactly what is on screen.
 *
 * LOCAL GATE, inert unless FUZZ_SEEDS is set, so it never runs in CI or in the
 * ordinary suite (a full sweep is half a minute). Run it with:
 *
 *   FUZZ_SEEDS=200 npx vitest run src/notes/editor/editor-fuzz.local.test.ts
 *
 * Environment overrides: `FUZZ_OPS`, `FUZZ_FIRST_SEED`,
 * `FUZZ_SKIP` (comma separated failure classes), `FUZZ_REPORT` (a path to write
 * the machine readable findings to).
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { buildNoteEditState } from '../edit/build-edit-state';
import { mountEditor } from './view/mount';
import type { DocumentMapper } from './mapper/document';
import type { BlockRegistry } from './registry/build';
import type { EditorServices } from './registry/types';
import { defaultTextStyle, type Block, type BlockPayload, type BlockType, type InlineSpan } from '../model/types';
import { blockSidLength, mintSid } from '../model/sid';
import { makeRng, type Rng } from './editor-fuzz-random';
import { applyOp, describeOp, generateOp, type FuzzContext, type FuzzOp } from './editor-fuzz-ops';
import { describeDifference, runChecks, type Failure } from './editor-fuzz-checks';

/** A difference message reduced to the shape of the difference, for grouping. */
function normalizeDifference(difference: string): string {
  return difference
    .split(' | ')[0]
    .split(':')[0]
    .replace(/\[\d+\]/g, '[]')
    .slice(0, 80);
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

const SEED_COUNT = envNumber('FUZZ_SEEDS', 200);
const OP_COUNT = envNumber('FUZZ_OPS', 150);
const FIRST_SEED = envNumber('FUZZ_FIRST_SEED', 1);
const SKIPPED = (process.env.FUZZ_SKIP ?? '')
  .split(',')
  .map((entry) => entry.trim())
  .filter((entry) => entry !== '');

/** A skip entry matches by prefix, so one entry covers a family of messages. */
function isSkipped(klass: string): boolean {
  return SKIPPED.some((entry) => klass.startsWith(entry));
}
const REPORT_PATH = process.env.FUZZ_REPORT ?? '';

/**
 * Checks that describe a difference rather than a defect.
 *
 * They are recorded and printed, but they do not end a sequence: stopping on
 * one would hide everything the rest of that seed would have found.
 */
const NON_BLOCKING = new Set(['roundTripDerived']);

/** How often an operation that changed the document is followed by an undo probe. */
const UNDO_PROBE_RATE = 0.25;
/** Replays a shrink pass is allowed before it settles for what it has. */
const SHRINK_BUDGET = 500;

// ---------------------------------------------------------------------------
// Starting documents
// ---------------------------------------------------------------------------

function span(text: string, style: Partial<typeof defaultTextStyle> = {}): InlineSpan {
  return { kind: 'text', text, style: { ...defaultTextStyle, ...style } };
}

let blockCounter = 0;

function makeBlock(
  type: BlockType,
  spans: InlineSpan[],
  payload: BlockPayload = { kind: 'empty' },
  children: Block[] | null = null,
): Block {
  blockCounter += 1;
  return {
    id: `fuzz-${String(blockCounter)}`,
    sid: '',
    type,
    spans,
    payload,
    meta: {},
    order: 0,
    children,
  };
}

/** Real sids, minted the way the model mints them; the mapper fixtures use ids the alphabet rejects. */
function withSids(blocks: readonly Block[], taken: Set<string> = new Set()): Block[] {
  return blocks.map((block) => {
    const sid = mintSid(taken, blockSidLength);
    taken.add(sid);
    return {
      ...block,
      sid,
      children: block.children ? withSids(block.children, taken) : null,
    };
  });
}

function proseStart(): Block[] {
  return [
    makeBlock('Text', [span('the first paragraph, with '), span('bold', { bold: true }), span(' inside it')]),
    makeBlock('Text', [span('')]),
    makeBlock('Text', [span('a second paragraph')]),
  ];
}

function richStart(): Block[] {
  return [
    makeBlock('Heading2', [span('A heading', { bold: true })]),
    makeBlock('BulletList', [span('first bullet')]),
    makeBlock('BulletList', [span('second bullet')]),
    makeBlock('Checklist', [span('a task')], { kind: 'checklist', checked: false }),
    makeBlock('Quote', [span('a quoted line')]),
    makeBlock('Code', [span('const x = 1;')], { kind: 'code', language: 'typescript', source: 'const x = 1;' }),
    makeBlock('Callout', [span('remember')], { kind: 'callout', emoji: '\u{1F4A1}', tone: 'note' }),
    makeBlock('Divider', [span('')]),
    makeBlock('Text', [span('trailing text')]),
  ];
}

function structuralStart(): Block[] {
  const cell = (text: string): Block =>
    makeBlock('ColumnGroup', [span('')], { kind: 'empty' }, [makeBlock('Text', [span(text)])]);
  return [
    makeBlock('Text', [span('above the split')]),
    makeBlock('TwoColumn', [span('')], { kind: 'twoColumn', splitRatio: 0.5 }, [cell('left'), cell('right')]),
    makeBlock('Equation', [span('')], { kind: 'equation', latex: 'E = mc^2' }),
    makeBlock('Image', [span('a caption')], {
      kind: 'image',
      path: 'attachment:fuzz01',
      alt: 'a caption',
      width: 240,
      align: 'center',
      crop: null,
    }),
    makeBlock('Text', [span('below')]),
  ];
}

function tableStart(): Block[] {
  const grid = [
    ['Drug', 'Class'],
    ['Levodopa', 'Precursor'],
  ];
  return [
    makeBlock('Heading3', [span('Doses')]),
    makeBlock(
      'Table',
      [span('')],
      {
        kind: 'table',
        columnWidths: [120, 140],
        headerRows: [true, false],
        headerColumns: [false, false],
        fullWidth: false,
      },
      grid.map((row) =>
        makeBlock(
          'TableRow',
          [span('')],
          { kind: 'empty' },
          row.map((value) => makeBlock('TableCell', [span(value)], { kind: 'tableCell', fill: '' })),
        ),
      ),
    ),
    makeBlock('Text', [span('after the table')]),
  ];
}

const STARTS: readonly { readonly name: string; readonly build: () => Block[] }[] = [
  { name: 'prose', build: proseStart },
  { name: 'rich', build: richStart },
  { name: 'structural', build: structuralStart },
  { name: 'table', build: tableStart },
];

function startFor(seed: number): { name: string; blocks: Block[] } {
  const entry = STARTS[seed % STARTS.length];
  return { name: entry.name, blocks: withSids(entry.build()) };
}

// ---------------------------------------------------------------------------
// The mount
// ---------------------------------------------------------------------------

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const services: Partial<EditorServices> = {
  resolveNoteTitle: () => 'A referenced note',
  loadAssetUrl: () => Promise.resolve(PIXEL),
  uploadAsset: () => Promise.resolve('attachment:fuzz-upload'),
};

interface Harness {
  readonly view: EditorView;
  readonly registry: BlockRegistry;
  readonly mapper: DocumentMapper;
  /** Doc-changing transactions plugins appended to the last dispatch. */
  appendedDocChanges: number;
  /**
   * Every document this session has ever stood at, one entry per dispatch.
   *
   * Per dispatch rather than per operation because history groups on its own
   * clock: a run of typed characters is several transactions, and an undo may
   * legitimately land between two of them.
   */
  readonly seen: Set<string>;
  /** Turned off while the harness is probing, so a probe cannot vouch for itself. */
  recording: boolean;
  destroy(): void;
}

function mountHarness(blocks: readonly Block[]): Harness {
  const built = buildNoteEditState(blocks, services);
  if (!built.ok) throw new Error(`the starting document quarantined: ${built.reason.message}`);

  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const mounted = mountEditor({ mount, state: built.state, registry: built.registry, services });

  const harness: Harness = {
    view: mounted.view,
    registry: built.registry,
    mapper: built.mapper,
    appendedDocChanges: 0,
    seen: new Set<string>([JSON.stringify(mounted.view.state.doc.toJSON())]),
    recording: true,
    destroy(): void {
      mounted.destroy();
      mount.remove();
    },
  };

  // Set after construction so the plugin view hooks that run during the mount
  // are not counted as an operation's repairs.
  mounted.view.setProps({
    dispatchTransaction(tr) {
      const applied = mounted.view.state.applyTransaction(tr);
      for (const appended of applied.transactions.slice(1)) {
        if (appended.docChanged) harness.appendedDocChanges += 1;
      }
      mounted.view.updateState(applied.state);
      if (harness.recording && tr.docChanged) {
        harness.seen.add(JSON.stringify(applied.state.doc.toJSON()));
      }
    },
  });

  return harness;
}

// ---------------------------------------------------------------------------
// One sequence
// ---------------------------------------------------------------------------

interface Finding {
  readonly seed: number;
  readonly start: string;
  readonly failure: Failure;
  readonly index: number;
  readonly ops: readonly FuzzOp[];
  /** The document as it stood immediately before the failing operation. */
  readonly docBefore: unknown;
  /** And immediately after it. */
  readonly docAfter: unknown;
}

interface Smell {
  readonly seed: number;
  readonly index: number;
  readonly op: string;
  readonly count: number;
}

interface RunOutcome {
  readonly ops: FuzzOp[];
  readonly finding: Finding | null;
  readonly smells: Smell[];
  /** Non-blocking observations, one entry per class, with the first example. */
  readonly notes: Map<string, string>;
}

interface RunOptions {
  readonly seed: number;
  /** Replayed when given, generated from the seed when null. */
  readonly ops: readonly FuzzOp[] | null;
  readonly opCount: number;
  /** Only failures in this check family are looked for; the rest are skipped for speed. */
  readonly onlyCheck?: string;
  readonly probeUndo: boolean;
}

function docJson(state: EditorState): string {
  return JSON.stringify(state.doc.toJSON());
}

/** One undo press through the keymap, exactly as the shortcut delivers it. */
function pressUndo(view: EditorView): void {
  const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
  view.someProp('handleKeyDown', (f) => f(view, event));
}

function runSequence(options: RunOptions): RunOutcome {
  const start = startFor(options.seed);
  const harness = mountHarness(start.blocks);
  const ctx: FuzzContext = { view: harness.view, registry: harness.registry };
  const rng: Rng = makeRng(options.seed * 2654435761);
  const recorded: FuzzOp[] = [];
  const smells: Smell[] = [];
  const notes = new Map<string, string>();

  const total = options.ops ? options.ops.length : options.opCount;

  try {
    for (let index = 0; index < total; index += 1) {
      const op = options.ops ? options.ops[index] : generateOp(rng, ctx);
      recorded.push(op);

      const before = harness.view.state;
      const beforeJson = docJson(before);
      harness.appendedDocChanges = 0;

      let thrown: unknown = null;
      try {
        applyOp(ctx, op);
      } catch (error) {
        thrown = error;
      }

      if (thrown !== null) {
        const message = thrown instanceof Error ? thrown.message : String(thrown);
        const failure: Failure = {
          check: 'threw',
          klass: `threw:${message.replace(/\d+/g, 'N').slice(0, 160)}`,
          detail: message + (thrown instanceof Error && thrown.stack ? `\n${thrown.stack}` : ''),
        };
        if (!isSkipped(failure.klass) && (options.onlyCheck === undefined || options.onlyCheck === 'threw')) {
          return {
            ops: recorded,
            finding: {
              seed: options.seed,
              start: start.name,
              failure,
              index,
              ops: [...recorded],
              docBefore: before.doc.toJSON(),
              docAfter: harness.view.state.doc.toJSON(),
            },
            smells,
            notes,
          };
        }
        continue;
      }

      const observed = runChecks(harness.view.state, harness.registry, harness.mapper);
      for (const failure of observed) {
        if (NON_BLOCKING.has(failure.check) && !notes.has(failure.klass)) {
          notes.set(failure.klass, `${describeOp(op)} -> ${failure.detail}`);
        }
      }
      const failures = observed.filter(
        (failure) =>
          !NON_BLOCKING.has(failure.check) &&
          !isSkipped(failure.klass) &&
          (options.onlyCheck === undefined || failure.check === options.onlyCheck),
      );
      if (failures.length > 0) {
        return {
          ops: recorded,
          finding: {
            seed: options.seed,
            start: start.name,
            failure: failures[0],
            index,
            ops: [...recorded],
            docBefore: before.doc.toJSON(),
            docAfter: harness.view.state.doc.toJSON(),
          },
          smells,
          notes,
        };
      }

      const afterJson = docJson(harness.view.state);
      const changed = afterJson !== beforeJson;

      if (op.kind === 'type' && harness.appendedDocChanges > 0) {
        smells.push({ seed: options.seed, index, op: describeOp(op), count: harness.appendedDocChanges });
      }

      if (options.probeUndo && changed && rng.chance(UNDO_PROBE_RATE)) {
        const after = harness.view.state;
        harness.recording = false;
        pressUndo(harness.view);
        const undone = docJson(harness.view.state);
        const undoneDoc: unknown = harness.view.state.doc.toJSON();
        harness.view.updateState(after);
        harness.recording = true;
        if (!harness.seen.has(undone)) {
          const difference = describeDifference(JSON.parse(beforeJson), undoneDoc);
          const failure: Failure = {
            check: 'undo',
            klass: `undo:${normalizeDifference(difference)}`,
            detail: `undo after ${describeOp(op)} produced a document no edit had ever produced; against the document before that operation: ${difference}`,
          };
          if (!isSkipped(failure.klass) && (options.onlyCheck === undefined || options.onlyCheck === 'undo')) {
            return {
              ops: recorded,
              finding: {
                seed: options.seed,
                start: start.name,
                failure,
                index,
                ops: [...recorded],
                docBefore: before.doc.toJSON(),
                docAfter: harness.view.state.doc.toJSON(),
              },
              smells,
              notes,
            };
          }
        }
      }
    }
  } finally {
    harness.destroy();
  }

  return { ops: recorded, finding: null, smells, notes };
}

// ---------------------------------------------------------------------------
// Shrinking
// ---------------------------------------------------------------------------

function reproduces(seed: number, ops: readonly FuzzOp[], klass: string, check: string): boolean {
  const outcome = runSequence({ seed, ops, opCount: ops.length, onlyCheck: check, probeUndo: check === 'undo' });
  return outcome.finding?.failure.klass === klass;
}

/**
 * The shortest sequence that still fails the same way.
 *
 * Operations are dropped one at a time, back to front, and each drop is kept
 * only while the same failure class survives it.
 */
function shrink(finding: Finding): FuzzOp[] {
  let current = finding.ops.slice(0, finding.index + 1);
  const klass = finding.failure.klass;
  const check = finding.failure.check;
  let budget = SHRINK_BUDGET;

  let progress = true;
  while (progress && budget > 0) {
    progress = false;
    for (let i = current.length - 2; i >= 0 && budget > 0; i -= 1) {
      const candidate = [...current.slice(0, i), ...current.slice(i + 1)];
      budget -= 1;
      if (reproduces(finding.seed, candidate, klass, check)) {
        current = candidate;
        progress = true;
      }
    }
  }
  return current;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

beforeAll(() => {
  // jsdom does no layout and ships none of these; ProseMirror's pointer path
  // asks the document what is under the cursor, menus scroll a row in, and
  // every `scrollIntoView()` on a transaction measures the caret with a Range.
  (document as Document & { elementFromPoint: () => Element | null }).elementFromPoint = () => null;
  Element.prototype.scrollIntoView = function scrollIntoView(): void {
    // no layout to scroll
  };
  const zeroRect = (): DOMRect =>
    ({
      x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  const noRects = (): DOMRectList => [] as unknown as DOMRectList;
  Range.prototype.getClientRects = noRects;
  Range.prototype.getBoundingClientRect = zeroRect;
  Element.prototype.getClientRects = noRects;
});

afterEach(() => {
  document.body.replaceChildren();
});

interface Report {
  seeds: number;
  ops: number;
  classes: {
    klass: string;
    check: string;
    detail: string;
    seeds: number[];
    start: string;
    minimal: string[];
    docBefore: unknown;
    docAfter: unknown;
  }[];
  smells: Smell[];
  notes: { klass: string; seeds: number; example: string }[];
}

// Skipped, not filtered out: a skipped test is visible in the run summary, so
// nobody mistakes a suite that never ran for one that passed.
const gate = process.env.FUZZ_SEEDS ? describe : describe.skip;

gate('editor operation fuzzer', () => {
  it(
    'holds every document invariant across randomized user-like sequences',
    () => {
      const report: Report = { seeds: SEED_COUNT, ops: OP_COUNT, classes: [], smells: [], notes: [] };
      const byClass = new Map<string, Finding[]>();
      const smells: Smell[] = [];
      const noteSeeds = new Map<string, { seeds: number; example: string }>();

      for (let i = 0; i < SEED_COUNT; i += 1) {
        const seed = FIRST_SEED + i;
        const outcome = runSequence({ seed, ops: null, opCount: OP_COUNT, probeUndo: true });
        smells.push(...outcome.smells);
        for (const [klass, example] of outcome.notes) {
          const entry = noteSeeds.get(klass);
          if (entry) entry.seeds += 1;
          else noteSeeds.set(klass, { seeds: 1, example });
        }
        if (!outcome.finding) continue;
        const existing = byClass.get(outcome.finding.failure.klass);
        if (existing) existing.push(outcome.finding);
        else byClass.set(outcome.finding.failure.klass, [outcome.finding]);
      }

      for (const [klass, findings] of byClass) {
        const first = findings[0];
        const minimal = shrink(first);
        report.classes.push({
          klass,
          check: first.failure.check,
          detail: first.failure.detail,
          seeds: findings.map((f) => f.seed),
          start: first.start,
          minimal: minimal.map(describeOp),
          docBefore: first.docBefore,
          docAfter: first.docAfter,
        });
      }
      report.smells = smells.slice(0, 40);
      report.notes = [...noteSeeds].map(([klass, entry]) => ({ klass, seeds: entry.seeds, example: entry.example }));

      if (REPORT_PATH !== '') {
        fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
        fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
      }

      const summary = report.classes.map(
        (entry) =>
          `\n[${entry.check}] ${entry.klass}\n  seeds: ${entry.seeds.slice(0, 8).join(', ')}${entry.seeds.length > 8 ? ' ...' : ''} (${String(entry.seeds.length)} of ${String(SEED_COUNT)})\n  start: ${entry.start}\n  detail: ${entry.detail}\n  minimal: ${entry.minimal.join(' ; ')}`,
      );
      expect(
        summary.join('\n'),
        `${String(report.classes.length)} failure class(es); non-blocking notes: ${report.notes.map((n) => `${n.klass} x${String(n.seeds)}`).join(', ')}; repairs after plain typing: ${String(smells.length)}`,
      ).toBe('');
    },
    30 * 60 * 1000,
  );
});
