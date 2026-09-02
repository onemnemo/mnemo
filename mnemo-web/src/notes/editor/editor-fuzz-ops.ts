/**
 * The operation vocabulary the editor fuzzer draws from, and how each one is
 * applied to a live `EditorView`.
 *
 * Every operation goes in through the same door a person does. Keys are
 * dispatched as `KeyboardEvent`s through `handleKeyDown`, so the plugin
 * precedence in `editorPlugins` is what decides the outcome, and typed text goes
 * through `handleTextInput` first so the markdown triggers fire exactly when a
 * real keystroke would fire them. Only what a browser would do natively (caret
 * motion, which jsdom has no layout to compute) is emulated, and only after
 * every plugin has declined the key.
 *
 * An operation record carries everything needed to replay it: no operation
 * consults the RNG at apply time, so a recorded sequence is deterministic apart
 * from the identifiers the editor mints, which are random by design.
 */

import { Selection, TextSelection, type Command, type Transaction } from 'prosemirror-state';
import { toggleMark } from 'prosemirror-commands';
import type { EditorView } from 'prosemirror-view';
import type { Rng } from './editor-fuzz-random';
import { COMMANDS_BY_ID, EDITOR_COMMANDS, type DirectCommand } from './commands/catalog';
import type { BlockRegistry } from './registry/build';
import { orderedSids } from '../selection/block-selection';
import { setBlockSelection } from '../selection/block-selection-plugin';

export interface FuzzContext {
  readonly view: EditorView;
  readonly registry: BlockRegistry;
}

export type FuzzOp =
  /** A run of characters, typed one at a time. */
  | { readonly kind: 'type'; readonly text: string }
  | { readonly kind: 'key'; readonly key: string; readonly shift?: boolean; readonly mod?: boolean }
  /** A block-level markdown marker typed at the start of the caret's line. */
  | { readonly kind: 'markdown'; readonly marker: string }
  /** A catalog command, through its chord where it has one. */
  | { readonly kind: 'format'; readonly commandId: string }
  | { readonly kind: 'link'; readonly href: string }
  /** Caret to a fraction of the document, the stand-in for a click. */
  | { readonly kind: 'caret'; readonly at: number }
  /** A text range between two fractions of the document. */
  | { readonly kind: 'range'; readonly from: number; readonly to: number }
  /** Whole blocks marked, by index into the selectable sids. */
  | { readonly kind: 'blockSelect'; readonly indices: readonly number[] }
  /** A slash-menu row run against the caret's block. */
  | { readonly kind: 'slash'; readonly nodeName: string; readonly label: string };

export function describeOp(op: FuzzOp): string {
  switch (op.kind) {
    case 'type':
      return `type(${JSON.stringify(op.text)})`;
    case 'key':
      return `key(${op.mod === true ? 'Mod-' : ''}${op.shift === true ? 'Shift-' : ''}${op.key})`;
    case 'markdown':
      return `markdown(${JSON.stringify(op.marker)})`;
    case 'format':
      return `format(${op.commandId})`;
    case 'link':
      return `link(${op.href})`;
    case 'caret':
      return `caret(${op.at.toFixed(3)})`;
    case 'range':
      return `range(${op.from.toFixed(3)}, ${op.to.toFixed(3)})`;
    case 'blockSelect':
      return `blockSelect([${op.indices.join(', ')}])`;
    case 'slash':
      return `slash(${op.label} -> ${op.nodeName})`;
  }
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const PUNCTUATION = '.,;:!?-_()[]{}"\'`*#>+=/\\|~^$%&@';
const EMOJI = ['\u{1F600}', '\u{1F469}‍\u{1F469}‍\u{1F467}‍\u{1F466}', '❤️'];

const MARKERS: readonly string[] = ['# ', '## ', '### ', '#### ', '- ', '* ', '1. ', '[] ', '[ ] ', '> ', '``` ', '--- '];

const ARROWS: readonly string[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

/**
 * Rows the harness never picks.
 *
 * `page` creates its note through an injected service before it writes
 * anything, so it is the one row whose effect lands on a later microtask; a
 * check run right after the operation would read a document the row has not
 * finished writing. It is called out in the report rather than fuzzed here.
 */
const UNFUZZED_SLASH_NODES = new Set(['page']);

function typeRun(rng: Rng): FuzzOp {
  const length = 1 + rng.int(8);
  let text = '';
  for (let i = 0; i < length; i += 1) {
    const roll = rng.next();
    if (roll < 0.62) text += LETTERS[rng.int(LETTERS.length)];
    else if (roll < 0.85) text += ' ';
    else if (roll < 0.97) text += PUNCTUATION[rng.int(PUNCTUATION.length)];
    else text += EMOJI[rng.int(EMOJI.length)];
  }
  return { kind: 'type', text };
}

/** The catalog commands the fuzzer runs; the swatches take a token and are driven as direct runs. */
const FORMAT_IDS: readonly string[] = EDITOR_COMMANDS.filter(
  (command) => command.kind === 'direct' && command.group !== 'history',
).map((command) => command.id);

export function generateOp(rng: Rng, ctx: FuzzContext): FuzzOp {
  const kind = rng.weighted([
    ['type', 34],
    ['enter', 8],
    ['softBreak', 3],
    ['backspace', 12],
    ['delete', 4],
    ['tab', 2],
    ['arrow', 10],
    ['markdown', 5],
    ['format', 6],
    ['link', 2],
    ['caret', 6],
    ['range', 5],
    ['blockSelect', 3],
    ['undo', 5],
    ['redo', 3],
    ['slash', 4],
    ['escape', 2],
  ] as const);

  switch (kind) {
    case 'type':
      return typeRun(rng);
    case 'enter':
      return { kind: 'key', key: 'Enter' };
    case 'softBreak':
      return { kind: 'key', key: 'Enter', shift: true };
    case 'backspace':
      return { kind: 'key', key: 'Backspace' };
    case 'delete':
      return { kind: 'key', key: 'Delete' };
    case 'tab':
      return { kind: 'key', key: 'Tab', shift: rng.chance(0.5) };
    case 'arrow':
      return { kind: 'key', key: rng.pick(ARROWS), shift: rng.chance(0.3) };
    case 'markdown':
      return { kind: 'markdown', marker: rng.pick(MARKERS) };
    case 'format':
      return { kind: 'format', commandId: rng.pick(FORMAT_IDS) };
    case 'link':
      return { kind: 'link', href: rng.chance(0.8) ? 'https://example.com/a' : 'mailto:a@b.c' };
    case 'caret':
      return { kind: 'caret', at: rng.next() };
    case 'range':
      return { kind: 'range', from: rng.next(), to: rng.next() };
    case 'blockSelect': {
      const count = 1 + rng.int(3);
      const indices: number[] = [];
      for (let i = 0; i < count; i += 1) indices.push(rng.int(64));
      return { kind: 'blockSelect', indices };
    }
    case 'undo':
      return { kind: 'key', key: 'z', mod: true };
    case 'redo':
      return { kind: 'key', key: 'y', mod: true };
    case 'escape':
      return { kind: 'key', key: 'Escape' };
    case 'slash': {
      const rows = ctx.registry.slash.filter((row) => !UNFUZZED_SLASH_NODES.has(row.nodeName));
      const row = rng.pick(rows);
      return { kind: 'slash', nodeName: row.nodeName, label: row.label };
    }
  }
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

function press(view: EditorView, key: string, mod: boolean, shift: boolean): boolean {
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: mod,
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  return view.someProp('handleKeyDown', (f) => f(view, event)) === true;
}

/**
 * One character in, the way ProseMirror's own input reader does it: every
 * plugin gets `handleTextInput` first, and the insert is only performed for the
 * character no plugin claimed.
 */
function textInput(view: EditorView, text: string): void {
  const { from, to } = view.state.selection;
  // The same fallback ProseMirror hands its own handlers, so a plugin that
  // wants the default transaction gets the one it would get in the browser.
  const fallback = (): Transaction => view.state.tr.insertText(text, from, to);
  const handled = view.someProp('handleTextInput', (f) => f(view, from, to, text, fallback)) ?? false;
  if (handled) return;
  view.dispatch(fallback().scrollIntoView());
}

function clampPos(view: EditorView, pos: number): number {
  return Math.max(0, Math.min(view.state.doc.content.size, pos));
}

/** The caret motion a browser performs natively, once every plugin has declined the arrow. */
function moveHorizontally(view: EditorView, dir: 1 | -1, extend: boolean): void {
  const { state } = view;
  const sel = state.selection;
  const from = dir < 0 ? sel.from : sel.to;
  const $target = state.doc.resolve(clampPos(view, from + dir));
  const near = Selection.near($target, dir);
  const next =
    extend && sel instanceof TextSelection
      ? TextSelection.between(state.doc.resolve(sel.anchor), near.$head, dir)
      : near;
  view.dispatch(state.tr.setSelection(next).scrollIntoView());
}

/** Up and down, approximated as a step past the current textblock; jsdom computes no lines. */
function moveVertically(view: EditorView, dir: 1 | -1, extend: boolean): void {
  const { state } = view;
  const sel = state.selection;
  const $head = sel.$head;
  const edge = dir < 0 ? $head.start() - 2 : $head.end() + 2;
  const $target = state.doc.resolve(clampPos(view, edge));
  const near = Selection.near($target, dir);
  const next =
    extend && sel instanceof TextSelection
      ? TextSelection.between(state.doc.resolve(sel.anchor), near.$head, dir)
      : near;
  view.dispatch(state.tr.setSelection(next).scrollIntoView());
}

interface Chord {
  readonly key: string;
  readonly mod: boolean;
  readonly shift: boolean;
}

/** `Mod-Shift-s` and friends, in the form the harness dispatches. */
export function parseChord(shortcut: string): Chord {
  const parts = shortcut.split('-');
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);
  return {
    key,
    mod: modifiers.some((m) => m === 'Mod' || m === 'Ctrl' || m === 'Cmd'),
    shift: modifiers.includes('Shift'),
  };
}

function runCommand(view: EditorView, command: Command): void {
  command(view.state, view.dispatch.bind(view), view);
}

function applyFormat(ctx: FuzzContext, commandId: string): void {
  const command = COMMANDS_BY_ID.get(commandId);
  if (!command) return;
  if (command.kind === 'swatch') {
    runCommand(ctx.view, command.runWith('swatch3'));
    return;
  }
  const direct: DirectCommand = command;
  // Through the chord where one exists, so plugin precedence decides; the rest
  // are toolbar-only commands with no key to press.
  if (direct.shortcut !== undefined) {
    const chord = parseChord(direct.shortcut);
    if (press(ctx.view, chord.key, chord.mod, chord.shift)) return;
    return;
  }
  runCommand(ctx.view, direct.run);
}

function applyKey(ctx: FuzzContext, key: string, mod: boolean, shift: boolean): void {
  if (press(ctx.view, key, mod, shift)) return;
  // Nothing claimed it. Only the caret motions have a native behaviour to
  // stand in for; Tab moves focus in a browser and Escape does nothing.
  if (key === 'ArrowLeft') moveHorizontally(ctx.view, -1, shift);
  else if (key === 'ArrowRight') moveHorizontally(ctx.view, 1, shift);
  else if (key === 'ArrowUp') moveVertically(ctx.view, -1, shift);
  else if (key === 'ArrowDown') moveVertically(ctx.view, 1, shift);
}

function applyCaret(ctx: FuzzContext, at: number): void {
  const { state } = ctx.view;
  const target = clampPos(ctx.view, Math.round(at * state.doc.content.size));
  ctx.view.dispatch(state.tr.setSelection(Selection.near(state.doc.resolve(target), 1)));
}

function applyRange(ctx: FuzzContext, from: number, to: number): void {
  const { state } = ctx.view;
  const size = state.doc.content.size;
  const a = clampPos(ctx.view, Math.round(Math.min(from, to) * size));
  const b = clampPos(ctx.view, Math.round(Math.max(from, to) * size));
  ctx.view.dispatch(
    state.tr.setSelection(TextSelection.between(state.doc.resolve(a), state.doc.resolve(b))),
  );
}

function applyBlockSelect(ctx: FuzzContext, indices: readonly number[]): void {
  const sids = orderedSids(ctx.view.state.doc, ctx.registry);
  if (sids.length === 0) return;
  const selected = new Set(indices.map((i) => sids[i % sids.length]));
  const [anchorSid] = selected;
  setBlockSelection(ctx.view, { selected, anchorSid: anchorSid ?? null });
}

function applyMarkdown(ctx: FuzzContext, marker: string): void {
  const { state } = ctx.view;
  const $from = state.selection.$from;
  if (!$from.parent.isTextblock) return;
  ctx.view.dispatch(
    state.tr.setSelection(TextSelection.create(state.doc, clampPos(ctx.view, $from.start()))),
  );
  for (const char of marker) textInput(ctx.view, char);
}

function applySlash(ctx: FuzzContext, nodeName: string, label: string): void {
  const row = ctx.registry.slash.find((r) => r.nodeName === nodeName && r.label === label);
  if (!row) return;
  void row.insert(ctx.view.state, ctx.view.dispatch.bind(ctx.view), {
    services: { resolveNoteTitle: () => undefined, loadAssetUrl: () => Promise.resolve(''), uploadAsset: () => Promise.resolve('') },
    currentState: () => ctx.view.state,
  });
}

export function applyOp(ctx: FuzzContext, op: FuzzOp): void {
  switch (op.kind) {
    case 'type':
      for (const char of op.text) textInput(ctx.view, char);
      return;
    case 'key':
      applyKey(ctx, op.key, op.mod ?? false, op.shift ?? false);
      return;
    case 'markdown':
      applyMarkdown(ctx, op.marker);
      return;
    case 'format':
      applyFormat(ctx, op.commandId);
      return;
    case 'link':
      runCommand(ctx.view, toggleMark(ctx.view.state.schema.marks.link, { href: op.href }));
      return;
    case 'caret':
      applyCaret(ctx, op.at);
      return;
    case 'range':
      applyRange(ctx, op.from, op.to);
      return;
    case 'blockSelect':
      applyBlockSelect(ctx, op.indices);
      return;
    case 'slash':
      applySlash(ctx, op.nodeName, op.label);
      return;
  }
}
