/**
 * A node label, open for typing, as a ProseMirror view over one line of runs.
 *
 * The notes editor's own schema and inline mapper, mounted over a document that holds exactly one
 * paragraph, so what the toolbar, the symbol palette and the equation atom do in a note they do in
 * a node with no second implementation. The document never becomes blocks: the plugin stack folds
 * anything that makes a second one straight back into the line.
 *
 * Framework free, like the notes mount it wraps. The React field around it owns the lifecycle and
 * hears about the label through `onChange` and `onFinish`; nothing here writes to the map.
 *
 * Loaded on the first edit rather than with the map, which is what keeps ProseMirror out of a route
 * that draws a thousand labels without opening one.
 */

import { EditorState, Selection, TextSelection } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"

import { lineOf } from "@/notes/editor/blocks/shared"
import { editorSchema } from "@/notes/editor/schema"
import { mountEditor } from "@/notes/editor/view/mount"
import type { InlineSpan } from "@/notes/model/types"
import "@/notes/page/notes-editor.css"

import { labelPlugins } from "./label-plugins"
import "./label-editor.css"

export interface LabelEditorOptions {
  readonly mount: HTMLElement
  readonly runs: readonly InlineSpan[]
  /** Where the caret opens: over the whole label, the way a field selects on open, or after it. */
  readonly caret?: "all" | "end"
  /** The camera under the node. Every tick moves the chrome anchored to the caret. */
  readonly camera?: { subscribe(listener: () => void): () => void }
  /** Every change to the runs, for the field that tracks what a teardown has to flush. */
  onChange(runs: InlineSpan[]): void
  /** Enter, or the focus leaving, with the runs; Escape with null. */
  onFinish(runs: InlineSpan[] | null): void
}

export interface LabelEditor {
  readonly view: EditorView
  /** The runs as they stand. */
  runs(): InlineSpan[]
  /** Idempotent. Takes the view, its DOM and every body-level surface it opened with it. */
  destroy(): void
}

/**
 * The chrome the editor mounts on `document.body` and can move the focus into: the toolbar under
 * its keyboard chord, and the two flyouts with a field of their own. Focus landing there is the
 * editor still being used, not left; anywhere else is a blur that finishes the label.
 */
const OWN_CHROME = ".notes-formatting-toolbar, .notes-link-flyout, .notes-equation-flyout"

function inOwnChrome(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(OWN_CHROME) !== null
}

export function openLabelEditor(options: LabelEditorOptions): LabelEditor {
  const { schema, registry, inline } = editorSchema()

  const line = schema.nodes.line.create(null, inline.toInline(options.runs, schema))
  const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, line))
  const caret =
    options.caret === "end"
      ? Selection.atEnd(doc)
      : TextSelection.create(doc, 2, 2 + line.content.size)

  const runsOf = (state: EditorState): InlineSpan[] => {
    const only = state.doc.firstChild ? lineOf(state.doc.firstChild) : null
    return only ? inline.fromInline(only) : inline.fromInline(line)
  }
  // Read through the view, which the key handlers below only ever run after it is mounted.
  const current = (): InlineSpan[] => runsOf(view.state)

  const state = EditorState.create({
    schema,
    doc,
    selection: caret,
    plugins: labelPlugins(registry, inline, {
      finish: () => options.onFinish(current()),
      abandon: () => options.onFinish(null),
    }),
  })

  const editor = mountEditor({ mount: options.mount, state, registry, editable: true })
  const { view } = editor

  view.setProps({
    dispatchTransaction(tr) {
      const next = view.state.apply(tr)
      view.updateState(next)
      if (tr.docChanged) {
        options.onChange(runsOf(next))
      }
    },
  })

  const onBlur = (event: FocusEvent): void => {
    if (inOwnChrome(event.relatedTarget)) {
      return
    }
    options.onFinish(current())
  }
  view.dom.addEventListener("blur", onBlur)

  // A pan or a zoom moves the node under a caret that has not moved. The toolbar, the link flyout
  // and the symbol palette all follow a scroll anywhere in the document through a capture listener
  // on the window, and that is what the camera moving is to them: the caret's screen position
  // changed and nothing in the document did. So the tick is told as a scroll of the editable root.
  const unsubscribe = options.camera?.subscribe(() => {
    view.dom.dispatchEvent(new Event("scroll"))
  })

  view.focus()

  let destroyed = false
  return {
    view,
    runs: current,
    destroy() {
      if (destroyed) {
        return
      }
      destroyed = true
      unsubscribe?.()
      view.dom.removeEventListener("blur", onBlur)
      editor.destroy()
    },
  }
}
