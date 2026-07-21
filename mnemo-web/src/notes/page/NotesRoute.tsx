import { NotesPage } from "./NotesPage"
import { NoteView } from "./NoteView"

/**
 * The single entry point for the `/notes` route, list or detail.
 *
 * It exists so the whole notes editor — ProseMirror, the mapper, KaTeX and its
 * fonts, roughly half a megabyte — can be one lazily loaded chunk kept out of
 * the initial app bundle. Every route but this one stays light, and the cost is
 * paid only when a note is actually opened, which fits a surface built for large
 * documents rather than for a fast first paint of the app shell.
 */
export default function NotesRoute({ noteId }: { noteId?: string }) {
  return noteId ? <NoteView noteId={noteId} /> : <NotesPage />
}
