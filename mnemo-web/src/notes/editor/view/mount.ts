/**
 * Mounts one `EditorView` for one open note, framework-free.
 *
 * The React hook is a thin wrapper over this (create in an effect, `destroy` in
 * cleanup); keeping the lifecycle here means the mount/teardown/note-switch
 * behaviour is testable without rendering React at all.
 *
 * One view per note, and `destroy` releases everything the mount created: the
 * view, its DOM, and the handle. A note switch is a `destroy` then a fresh
 * `mountEditor`, never a state swap into a surviving view, a reused view keeps
 * the previous note's NodeView instances, decorations and undo history, which is
 * exactly the leak this guards against.
 *
 * The initial `EditorState` is built by the caller (the mapper plus the shared
 * schema), so this stays out of the load and quarantine path the read layer owns. It
 * must be built from the same schema the `registry` came from, PM compares node
 * types by identity, so two schemas in one document read as corruption.
 *
 * ## Large notes mount in chunks
 *
 * `new EditorView` builds a NodeView for every top-level block in one
 * synchronous call, and past a few thousand blocks that call is long enough to
 * freeze the tab. Past {@link DEFAULT_CHUNK_THRESHOLD} blocks, this mounts only
 * the first slice of the document, fast, and immediately interactive, and
 * appends the rest across animation frames afterward.
 *
 * The appends never go through `view.dispatch`, only `view.updateState`, so
 * they never reach `dispatchTransaction` and never look like an edit to the
 * authority: no revision bump, no dirty flag, no autosave. They are tagged
 * `addToHistory: false` for the same reason on the history plugin's side, a
 * user's first undo on a freshly opened large note must undo their own first
 * edit, not the last chunk of the load. Each chunk inserts at the *current*
 * document's end rather than a position computed up front, so a user typing
 * into the already-mounted prefix while the rest streams in cannot be
 * clobbered by a later chunk, appending at the live end never touches
 * positions inside what is already there.
 *
 * ## A half-loaded document is never observable
 *
 * Chunking is a *rendering* strategy, and it must not turn into a document
 * one. The authority reads its document from `handle.state` and autosave PUTs
 * that as the entire note, so a read taken mid-load would persist the blocks
 * that had arrived and delete every block that had not.
 *
 * So the partial state stays private to the view. Anything that asks this
 * mount for the document, through the handle or by touching the editor,
 * finishes the load synchronously first and gets the whole thing:
 *
 *  - The **handle** drains before every `state` read and every `apply`. That
 *    covers saving, and it covers programmatic writers, which read the state
 *    to build their transaction and so are handed a complete document before
 *    they build anything.
 *  - **Touching the editor** drains too, before ProseMirror can build a
 *    transaction of its own. A keystroke's transaction is constructed from
 *    `view.state` deep inside PM's DOM reader, far too late to intervene, so
 *    the load is finished at the first sign of a user, on focus or on the
 *    press that precedes the focus.
 *
 * The cost is a synchronous finish for a user who starts editing a very large
 * note within the first moment of opening it, which is the correct trade: the
 * freeze this avoids is on the path everyone takes, and the freeze it keeps is
 * on the path that would otherwise lose data.
 */

import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorHandle } from '../../authority/handle';

import type { BlockRegistry } from '../registry/build';
import type { EditorServices } from '../registry/types';
import { createViewHandle } from './handle';
import { resolveServices, toNodeViews } from './nodeviews';

/** Below this many top-level blocks, a note mounts exactly as it always has. */
const DEFAULT_CHUNK_THRESHOLD = 2000;
/** The synchronous first slice, sized to be interactive almost immediately. */
const DEFAULT_FIRST_CHUNK_SIZE = 500;
/** Blocks per background append once chunking has kicked in. */
const DEFAULT_CHUNK_SIZE = 1000;

function defaultSchedule(run: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, 0);
}

export interface MountEditorOptions {
  /** The element the view attaches its editable DOM to. */
  readonly mount: HTMLElement;
  /** The note's initial state, built from the same schema as `registry`. */
  readonly state: EditorState;
  readonly registry: BlockRegistry;
  /** Note-title and asset resolvers; defaulted where absent. */
  readonly services?: Partial<EditorServices>;
  /**
   * Whether the view accepts input. Defaults to `true`. The read path mounts
   * with `false`, which keeps the contentEditable off and the caret out, the
   * DOM still renders through the same NodeViews, so a read-only note and an
   * editable one are the identical render, differing only in what the user can
   * do to it.
   */
  readonly editable?: boolean;
  /** Blocks above which the mount chunks itself. Tunable so tests need not build a 2000-block fixture. */
  readonly chunkThreshold?: number;
  /** Blocks in the synchronous first chunk, once chunking applies. */
  readonly firstChunkSize?: number;
  /** Blocks per background chunk after the first. */
  readonly chunkSize?: number;
  /** Schedules the next background chunk; defaults to `requestAnimationFrame`. */
  readonly schedule?: (run: () => void) => void;
}

/** Appends `nodes` at the document's live end, invisibly to the authority. */
function appendNodes(view: EditorView, nodes: readonly PMNode[]): void {
  // Read the live state, not one captured when this was scheduled: a user's
  // edit to the already-mounted prefix must not be discarded by an append that
  // assumed the document was still exactly as it was.
  const live = view.state;
  const tr = live.tr
    .insert(live.doc.content.size, nodes as PMNode[])
    .setMeta('addToHistory', false);
  view.updateState(live.apply(tr));
}

export interface MountedEditor {
  readonly view: EditorView;
  readonly handle: EditorHandle;
  /** Idempotent. Destroys the view, its DOM and the handle. */
  destroy(): void;
}

export function mountEditor(options: MountEditorOptions): MountedEditor {
  const services = resolveServices(options.services);
  const nodeViews = toNodeViews(options.registry, services);

  const children: PMNode[] = [];
  options.state.doc.forEach((child) => children.push(child));

  const threshold = options.chunkThreshold ?? DEFAULT_CHUNK_THRESHOLD;
  const chunking = children.length > threshold;
  const firstChunkSize = options.firstChunkSize ?? DEFAULT_FIRST_CHUNK_SIZE;

  // Below the threshold this is `options.state`, unchanged, the vast majority
  // of notes never take this branch at all.
  const initialState = chunking
    ? EditorState.create({
        schema: options.state.schema,
        doc: options.state.doc.type.create(null, children.slice(0, firstChunkSize)),
        plugins: options.state.plugins,
      })
    : options.state;

  const editable = options.editable ?? true;
  const view = new EditorView(options.mount, {
    state: initialState,
    nodeViews,
    editable: () => editable,
    attributes: {
      // ProseMirror sets no spellcheck attribute, so a contenteditable root would
      // otherwise inherit the engine's default and a *read-only* note would be
      // underlined for "mistakes" the reader cannot act on. Stating it per mode
      // keeps the native checker where it belongs: an editing affordance on the
      // editable view, and nothing at all on the read-only one. On the editable
      // view it stays view-only in the sense that matters, a spellchecker
      // replacement is a DOM change PM reads back as a transaction, so it goes
      // through the same invariant pipeline as typing rather than around it.
      spellcheck: String(editable),
    },
  });
  const viewHandle = createViewHandle(view);

  let destroyed = false;
  /** Blocks not yet in the view's state. Empty whenever the load is complete. */
  let pending: PMNode[][] = [];

  /** Puts every outstanding block into the view at once. Idempotent. */
  function finishLoad(): void {
    if (pending.length === 0) return;
    const remaining = pending.flat();
    // Cleared first: appending runs plugin view hooks, and one of those
    // reading the handle would otherwise re-enter this and append twice.
    pending = [];
    appendNodes(view, remaining);
  }

  // Every read drains first, so a partial state is never something the
  // authority, a save, or a command can observe. Draining on the *read* is
  // what makes it safe: ProseMirror rejects a transaction whose base document
  // is not the current one, so a caller that built a transaction from a
  // half-loaded state could not have applied it anyway.
  const handle: EditorHandle = {
    get state() {
      finishLoad();
      return viewHandle.state;
    },
    apply(tr) {
      finishLoad();
      return viewHandle.apply(tr);
    },
    destroy(): void {
      pending = [];
      viewHandle.destroy();
    },
  };

  function onFirstTouch(): void {
    finishLoad();
  }

  if (chunking) {
    const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    const schedule = options.schedule ?? defaultSchedule;
    for (let i = firstChunkSize; i < children.length; i += chunkSize) {
      pending.push(children.slice(i, i + chunkSize));
    }

    // Ahead of anything ProseMirror does with the event: a keystroke's
    // transaction is built from `view.state` inside PM's own DOM reader, so
    // the document has to be whole before the user gets that far.
    view.dom.addEventListener('focus', onFirstTouch, true);
    view.dom.addEventListener('pointerdown', onFirstTouch, true);
    view.dom.addEventListener('keydown', onFirstTouch, true);

    const step = (): void => {
      if (destroyed) return;
      const chunk = pending.shift();
      // Absent because `finishLoad` already drained everything, which is the
      // ordinary outcome once the user has touched the note.
      if (!chunk) return;
      appendNodes(view, chunk);
      if (pending.length > 0) schedule(step);
    };
    schedule(step);
  }

  return {
    view,
    handle,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      view.dom.removeEventListener('focus', onFirstTouch, true);
      view.dom.removeEventListener('pointerdown', onFirstTouch, true);
      view.dom.removeEventListener('keydown', onFirstTouch, true);
      // The handle's destroy is what calls `view.destroy()`; going through it
      // keeps a single owner of the view's teardown and stays idempotent.
      handle.destroy();
    },
  };
}
