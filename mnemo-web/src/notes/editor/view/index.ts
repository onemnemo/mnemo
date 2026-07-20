/**
 * The React↔ProseMirror mount seam: one `EditorView` per open note, its
 * lifecycle, and the adapter that turns registered realized views into
 * ProseMirror NodeViews. The document schema, mapper and blocks are elsewhere;
 * this is where a document becomes a live, mounted editor.
 */

export { createViewHandle } from './handle';
export { toNodeViews, resolveServices } from './nodeviews';
export { mountEditor, type MountEditorOptions, type MountedEditor } from './mount';
export {
  useEditorView,
  type UseEditorViewOptions,
  type UseEditorViewResult,
} from './useEditorView';
