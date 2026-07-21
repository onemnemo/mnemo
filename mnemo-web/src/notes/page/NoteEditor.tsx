import "katex/dist/katex.min.css"
import "./notes-editor.css"

import type { EditorState } from "prosemirror-state"

import type { BlockRegistry } from "../editor/registry/build"
import { useEditorView } from "../editor/view/useEditorView"

/**
 * Renders one note's document, editable.
 *
 * The sibling of {@link ReadOnlyEditor}, and deliberately almost identical to it:
 * both mount the same NodeViews producing the same DOM, so an editable note and a
 * read-only one are the same render. The only differences are that the state was
 * built with the editing plugin stack (`buildNoteEditState`) and that the view is
 * left editable — the hook's default — so the caret is live and the plugins act
 * on input.
 *
 * This is the editing surface, not yet the saving one: a transaction changes the
 * in-memory document but nothing here writes it back. Wiring autosave to the
 * document authority is the next milestone; until then edits live only for the
 * session, which is why the route still builds from the stored blocks each mount.
 *
 * `key` is the note identity, so switching notes fully destroys and remounts
 * rather than swapping a document into a surviving view.
 */
export function NoteEditor({
  noteId,
  state,
  registry,
}: {
  noteId: string
  state: EditorState
  registry: BlockRegistry
}) {
  const { ref } = useEditorView({ key: noteId, state, registry, editable: true })
  return <div ref={ref} className="notes-doc" />
}
