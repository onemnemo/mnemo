import { NotesWorkspace } from "../workspace/NotesWorkspace"

/**
 * The single entry point for the `/notes` route.
 *
 * It exists so the whole notes editor, ProseMirror, the mapper, KaTeX and its
 * fonts, roughly half a megabyte, can be one lazily loaded chunk kept out of the
 * initial app bundle. The route is one surface, the tree sidebar beside the
 * editor, whether or not a note is open; `noteId` only decides what fills the
 * editor half.
 */
export default function NotesRoute({ noteId }: { noteId?: string }) {
  return <NotesWorkspace noteId={noteId} />
}
