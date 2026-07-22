import "katex/dist/katex.min.css"
import "./notes-editor.css"

import type { EditorState } from "prosemirror-state"

import type { BlockRegistry } from "../editor/registry/build"
import { useEditorView } from "../editor/view/useEditorView"

/**
 * Renders one note's document, read-only.
 *
 * The whole load-and-quarantine decision has already been made by the caller,
 * this only mounts a state that is known good. `editable: false` keeps the caret
 * and contentEditable off; the DOM is produced by the same NodeViews an editable
 * mount would use, so this is the identical render, minus the ability to change
 * it. `key` is the note identity, so switching notes fully destroys and remounts
 * rather than swapping a document into a surviving view.
 *
 * KaTeX's stylesheet is imported here, at the first and only place an editor is
 * mounted, so the inline equation views render with their fonts.
 */
export function ReadOnlyEditor({
  noteId,
  state,
  registry,
}: {
  noteId: string
  state: EditorState
  registry: BlockRegistry
}) {
  const { ref } = useEditorView({ key: noteId, state, registry, editable: false })
  return <div ref={ref} className="notes-doc" />
}
