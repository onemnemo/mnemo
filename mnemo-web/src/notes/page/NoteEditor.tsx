import "katex/dist/katex.min.css"
import "./notes-editor.css"

import { useMemo } from "react"
import type { EditorState } from "prosemirror-state"

import { useNoteContentCommitter } from "../api"
import type { DocumentMapper } from "../editor/mapper/document"
import type { BlockRegistry } from "../editor/registry/build"
import { useNoteSession } from "../edit/useNoteSession"
import { createPersist } from "../save/persist"
import { SaveStatus } from "./SaveStatus"

/**
 * Renders one note's document, editable and saving.
 *
 * The sibling of {@link ReadOnlyEditor}, and deliberately almost identical to it:
 * both mount the same NodeViews producing the same DOM, so an editable note and a
 * read-only one are the same render. What differs is that the state was built with
 * the editing plugin stack, and that the view dispatches through a document
 * authority which an autosave writes from.
 *
 * `key` is the note identity, so switching notes fully destroys and remounts
 * rather than swapping a document into a surviving view.
 */
export function NoteEditor({
  noteId,
  sid,
  ver,
  state,
  registry,
  mapper,
  onReload,
}: {
  noteId: string
  sid: string
  ver: number
  state: EditorState
  registry: BlockRegistry
  mapper: DocumentMapper
  onReload: () => void
}) {
  const commit = useNoteContentCommitter()
  // Built once per note. A persist rebuilt on every render would mint a new
  // session id each time, and the request id that makes a retry idempotent
  // would stop identifying an edit.
  const persist = useMemo(
    () => createPersist({ fromDoc: (doc) => mapper.fromDoc(doc), commit }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [noteId],
  )

  const { ref, saveState } = useNoteSession({ noteId, sid, ver, state, registry, persist })

  return (
    <>
      <SaveStatus state={saveState} onReload={onReload} />
      <div ref={ref} className="notes-doc" />
    </>
  )
}
