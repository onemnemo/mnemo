/**
 * Mounts one `EditorView` for one open note, framework-free.
 *
 * The React hook is a thin wrapper over this (create in an effect, `destroy` in
 * cleanup); keeping the lifecycle here means the mount/teardown/note-switch
 * behaviour is testable without rendering React at all.
 *
 * One view per note, and `destroy` releases everything the mount created: the
 * view, its DOM, and the handle. A note switch is a `destroy` then a fresh
 * `mountEditor`, never a state swap into a surviving view — a reused view keeps
 * the previous note's NodeView instances, decorations and undo history, which is
 * exactly the leak this guards against.
 *
 * The initial `EditorState` is built by the caller (the mapper plus the shared
 * schema), so this stays out of the load and quarantine path that M7 owns. It
 * must be built from the same schema the `registry` came from — PM compares node
 * types by identity, so two schemas in one document read as corruption.
 */

import { EditorView } from 'prosemirror-view';
import type { EditorState } from 'prosemirror-state';
import type { EditorHandle } from '../../authority/handle';
import type { BlockRegistry } from '../registry/build';
import type { EditorServices } from '../registry/types';
import { createViewHandle } from './handle';
import { resolveServices, toNodeViews } from './nodeviews';

export interface MountEditorOptions {
  /** The element the view attaches its editable DOM to. */
  readonly mount: HTMLElement;
  /** The note's initial state, built from the same schema as `registry`. */
  readonly state: EditorState;
  readonly registry: BlockRegistry;
  /** Note-title and asset resolvers; defaulted where absent. */
  readonly services?: Partial<EditorServices>;
  /**
   * Whether the view accepts input. Defaults to `true`. M7's read path mounts
   * with `false`, which keeps the contentEditable off and the caret out — the
   * DOM still renders through the same NodeViews, so a read-only note and an
   * editable one are the identical render, differing only in what the user can
   * do to it.
   */
  readonly editable?: boolean;
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

  const editable = options.editable ?? true;
  const view = new EditorView(options.mount, {
    state: options.state,
    nodeViews,
    editable: () => editable,
  });
  const handle = createViewHandle(view);

  let destroyed = false;

  return {
    view,
    handle,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      // The handle's destroy is what calls `view.destroy()`; going through it
      // keeps a single owner of the view's teardown and stays idempotent.
      handle.destroy();
    },
  };
}
