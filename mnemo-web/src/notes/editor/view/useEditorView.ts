/**
 * The React hook over `mountEditor`: one `EditorView` per open note, tied to a
 * component's lifecycle.
 *
 * All the real work is in `mountEditor`; this is the thin React seam. It creates
 * the view in an effect and destroys it in cleanup, so unmount and note switch
 * both release the view through the same path — and so StrictMode's deliberate
 * mount/unmount/mount double-invoke leaves exactly one live view rather than a
 * leaked one, which is the cheapest place to catch a teardown that does not.
 *
 * `key` is the note identity. The effect depends on it and nothing else: the
 * initial `state`, `registry` and `services` are read from a ref at mount time,
 * so a new `state` object on a keystroke re-render does not tear down and
 * rebuild the view under the user. Switching notes means a new `key`, which is
 * a full destroy-then-remount — never a state swap into the surviving view.
 */

import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { EditorState } from 'prosemirror-state';
import type { EditorHandle } from '../../authority/handle';
import type { BlockRegistry } from '../registry/build';
import type { EditorServices } from '../registry/types';
import { mountEditor } from './mount';

export interface UseEditorViewOptions {
  /** The open note's identity. A change remounts the view. */
  readonly key: string;
  /** The initial state, read once per mount — later objects do not remount. */
  readonly state: EditorState;
  readonly registry: BlockRegistry;
  readonly services?: Partial<EditorServices>;
}

export interface UseEditorViewResult {
  /** Attach to the element the editor should mount into. */
  readonly ref: RefObject<HTMLDivElement | null>;
  /** The live handle, or null between unmount and the next mount. */
  readonly handle: EditorHandle | null;
}

export function useEditorView(options: UseEditorViewOptions): UseEditorViewResult {
  const ref = useRef<HTMLDivElement | null>(null);
  const [handle, setHandle] = useState<EditorHandle | null>(null);

  // The mount reads these at effect time, not from the closure, so they can
  // change between renders without forcing a remount — only `key` does that.
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const { state, registry, services } = latest.current;
    const mounted = mountEditor({ mount: element, state, registry, services });
    setHandle(mounted.handle);

    return () => {
      mounted.destroy();
      setHandle(null);
    };
  }, [options.key]);

  return { ref, handle };
}
