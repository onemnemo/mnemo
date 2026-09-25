/**
 * The plugin stack a node label is edited under.
 *
 * The notes editor's inline tier and nothing of its block tier: no structural keymap, no block
 * selection, no gap cursor, no slash menu, no invariant pipeline. A label is one line of runs, so
 * everything that knows what a second block is stays out, and the one plugin the map owns folds a
 * second block back into the line the moment something makes one.
 *
 * ProseMirror gives an earlier plugin first refusal on a key and runs `appendTransaction` hooks in
 * order, so the list below is an ordering, not a set:
 *
 *  - `nestedInputGuard` is first because its whole job is to answer before the others: a key or a
 *    paste inside the equation card's source field belongs to that field.
 *  - `clipboardPlugin` owns copy, cut and paste. Given no asset support, since a label cannot hold
 *    a picture; an image reference in a pasted slice is folded away below.
 *  - `controlCharGuard` follows it: the notes editor's repair, the backstop for a plain-text
 *    drop and anything else the text-input guard misses.
 *  - `singleLinePlugin` appends after the paste and after anything else that leaves the document
 *    with more than one block, and folds them into one paragraph with the lines joined by `\n`.
 *    It has to be an append and not a paste hook: an internal slice and a plain paste with a
 *    newline both arrive as a run of blocks through `handlePaste`, which places them itself, so a
 *    `transformPasted` hook would never see them.
 *  - `symbolPalettePlugin` and `equationOpenOnInsert` sit before every keymap. The palette claims
 *    Enter, Escape and the arrows while it is open, and the label's own Enter and Escape below
 *    must not reach a press that was meant for the list.
 *  - `inputTriggerPlugin` runs on text input, not on a key chord, so it sits before the keymaps
 *    without competing with them. It is given the script shortcuts only: the registry's own
 *    triggers are the block markers, and a label that turned into a list item on `1. ` would be
 *    folded straight back to a paragraph with the marker eaten.
 *  - `scriptAssistancePlugin` follows the triggers so a terminating Space converts literal syntax
 *    first; `autoLinkPlugin` follows both for the same reason.
 *  - `controlCharTextInputGuard` is last of the `handleTextInput` plugins, as in the notes editor.
 *  - `labelKeymap` is the map's own: Enter and Mod-Enter finish, Shift-Enter breaks the line,
 *    Escape abandons, Tab goes nowhere. It sits ahead of `editorKeymap`, whose Mod-Enter is the
 *    checklist toggle, and of `baseKeymap`, whose Enter would split the block and whose Mod-Enter
 *    is `exitCode`.
 *  - `editorKeymap` carries the formatting chords; `baseKeymap` is the default of last resort.
 *  - `scriptEscapeKeymap` is where an armed subscript or superscript ends. The label's Escape
 *    declines while one is armed, so the first press falls through to here and only the next
 *    press abandons the edit.
 *  - `editorHistory` and `historyBoundaryPlugin` close an undo group after a discrete edit, and
 *    the fold above has to be inside that group rather than after it.
 *  - `formattingToolbarPlugin` binds one chord and mounts its bubble on `document.body`;
 *    `linkInteractionPlugin` is after it because the toolbar's plugin view publishes the link
 *    flyout that its Edit action opens.
 */

import { baseKeymap } from "prosemirror-commands"
import { keymap } from "prosemirror-keymap"
import { Fragment, type Node as PMNode } from "prosemirror-model"
import { Plugin, TextSelection, type Command, type EditorState, type Transaction } from "prosemirror-state"

import { clipboardPlugin } from "@/notes/clipboard/clipboard-plugin"
import { equationOpenOnInsert } from "@/notes/editor/atoms"
import { editorKeymap } from "@/notes/editor/commands"
import { insertSoftBreak } from "@/notes/editor/commands/structure"
import { editorHistory, historyBoundaryPlugin } from "@/notes/editor/history"
import type { InlineMapper } from "@/notes/editor/mapper/inline"
import { autoLinkPlugin } from "@/notes/editor/marks/auto-link"
import { linkInteractionPlugin } from "@/notes/editor/marks/link-interaction"
import { controlCharGuard, controlCharTextInputGuard } from "@/notes/editor/pipeline/control-chars"
import { inputTriggerPlugin } from "@/notes/editor/pipeline/input-triggers"
import { nestedInputGuard } from "@/notes/editor/pipeline/nested-input"
import type { BlockRegistry } from "@/notes/editor/registry/build"
import { scriptAssistancePlugin, scriptEscapeKeymap } from "@/notes/editor/scripts/assistance"
import { clearStoredScripts } from "@/notes/editor/scripts/marks"
import { scriptShortcutTriggers } from "@/notes/editor/scripts/shortcuts"
import { symbolPalettePlugin } from "@/notes/editor/symbols"
import { formattingToolbarPlugin } from "@/notes/editor/toolbar/formatting-toolbar"

export interface LabelKeys {
  /** Enter, with the label as it stands. */
  finish(): void
  /** Escape, with nothing armed to end first. */
  abandon(): void
}

export function labelPlugins(registry: BlockRegistry, inline: InlineMapper, keys: LabelKeys): Plugin[] {
  return [
    nestedInputGuard(),
    clipboardPlugin(registry, inline),
    controlCharGuard(),
    singleLinePlugin(),
    symbolPalettePlugin(),
    equationOpenOnInsert(),
    inputTriggerPlugin({ ...registry, inputTriggers: [] }, scriptShortcutTriggers()),
    scriptAssistancePlugin(),
    autoLinkPlugin(),
    controlCharTextInputGuard(),
    labelKeymap(keys),
    editorKeymap(),
    keymap(baseKeymap),
    scriptEscapeKeymap(),
    editorHistory(),
    historyBoundaryPlugin(),
    formattingToolbarPlugin(),
    linkInteractionPlugin(),
  ]
}

function labelKeymap(keys: LabelKeys): Plugin {
  const finish: Command = () => {
    keys.finish()
    return true
  }
  const escape: Command = (state) => {
    // An armed script is what this press means to end; the keymap below ends it.
    if (clearStoredScripts(state)) {
      return false
    }
    keys.abandon()
    return true
  }
  const swallow: Command = () => true
  return keymap({
    Enter: finish,
    "Mod-Enter": finish,
    "Shift-Enter": insertSoftBreak,
    Escape: escape,
    Tab: swallow,
    "Shift-Tab": swallow,
  })
}

/**
 * Keeps the document one paragraph.
 *
 * Anything that leaves more than one block, or a block of another type, is folded: every line in
 * the document, in order, joined by a newline into one paragraph, marks and atoms kept. A block
 * with no line of its own (a picture, a divider) contributes only its break. The caret lands where
 * it was, measured along the joined line, so a paste still ends after what it pasted.
 */
export function singleLinePlugin(): Plugin {
  return new Plugin({
    appendTransaction(_transactions, _before, state) {
      return isOneParagraph(state.doc) ? null : fold(state)
    },
  })
}

function isOneParagraph(doc: PMNode): boolean {
  const only = doc.childCount === 1 ? doc.firstChild : null
  return only?.type.name === "paragraph" && only.childCount === 1 && only.firstChild?.type.name === "line"
}

function fold(state: EditorState): Transaction {
  const { schema, doc } = state
  const head = state.selection.head
  const inline: PMNode[] = []
  let caret: number | null = null
  // The joined content's size so far, which is what the new caret is measured along.
  let size = 0
  let lines = 0

  doc.descendants((node, pos) => {
    if (node.type.name !== "line" && node.type.name !== "codeLine") {
      return true
    }
    if (lines > 0) {
      inline.push(schema.text("\n"))
      size += 1
    }
    lines += 1
    if (caret === null && head >= pos + 1 && head <= pos + 1 + node.content.size) {
      caret = size + (head - pos - 1)
    }
    node.content.forEach((child) => inline.push(child))
    size += node.content.size
    return false
  })

  const line = schema.nodes.line.create(null, Fragment.fromArray(inline))
  const paragraph = schema.nodes.paragraph.create(null, line)
  const tr = state.tr.replaceWith(0, doc.content.size, paragraph)
  // One for the paragraph's opening token and one for the line's.
  const at = 2 + (caret ?? line.content.size)
  return tr.setSelection(TextSelection.create(tr.doc, Math.min(at, tr.doc.content.size - 2)))
}
