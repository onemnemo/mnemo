/**
 * The label, as a field.
 *
 * Rendered in the label's own place inside the node rather than as an overlay positioned to match
 * it, so "nothing jumps when you start typing" is true by construction rather than by two sets of
 * numbers agreeing. It carries the same metrics the projector measured the box with, which is why
 * the caret lands exactly where the text was.
 *
 * Two fields, by what the kind can hold. A label that is its own to format (a text or task node, a
 * shape's label, a caption) opens as runs in the notes editor, with its toolbar, its symbol palette
 * and its atoms. A code node's source and a link's title stay a plain textarea: source is columns,
 * and a title is the link's, not a place for bold.
 *
 * The editor chunk is loaded here, on the first label that opens, and not with the map, so a route
 * drawing a thousand nodes carries no ProseMirror until someone types. Until it arrives the label is
 * the plain textarea, and whatever was typed into it is carried across as one unstyled run; after
 * the first load the swap never shows again.
 *
 * Uncontrolled on purpose: a controlled value would cost a render of the canvas subtree per
 * keystroke to move a caret, and nothing outside this field needs to see the text until it is done.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"
import type { InlineSpan } from "@/notes/model/types"

import type { FieldResult } from "../edit/label-commit"
import { contentText } from "../model/document"
import { canHoldRuns, flattenRuns, plainRuns } from "../model/runs"
import type { SceneElement } from "../model/scene"
import { bodyOf, runsOf } from "../scene/content"
import { FONTS, fontScaleOf } from "../scene/measure"
import { cameraSignal } from "./camera-signal"
import type { ElementBox } from "./edge-paths"
import { loadLabelEditor, loadedLabelEditor, type LabelEditorModule } from "./label-editor-chunk"
import { useFieldFlush, type FieldFlush } from "./useFieldFlush"
import { useLiveBox, type LiveResize } from "./useLiveBox"

export interface NodeEditorProps {
  element: SceneElement
  /** How the field closed. Any promise it returns is the write. */
  onEditEnd?: (id: string, result: FieldResult) => void | Promise<unknown>
  /** The box this node is taking while it is typed into, so the branches meeting it can follow. */
  onEditResize?: (id: string, box: ElementBox) => void
}

export function NodeEditor(props: NodeEditorProps) {
  return canHoldRuns(props.element.content) ? <RunsField {...props} /> : <TextField {...props} />
}

/** A source or a title: the textarea, closing with its text. */
function TextField({ element, onEditEnd, onEditResize }: NodeEditorProps) {
  const { text, isRoot } = element
  const body = bodyOf(element.content)
  const { finish, track } = useFieldFlush<string>(plainText(element), (value) =>
    onEditEnd?.(element.id, value === null ? null : { text: value }),
  )
  const resize = useLiveBox(element, onEditResize)

  const mount = useCallback(
    (node: HTMLTextAreaElement | null) => {
      if (!node) {
        return
      }
      node.focus({ preventScroll: true })
      node.select()
      resize(node, { text: node.value })
    },
    [resize],
  )

  return (
    <textarea
      ref={mount}
      // select-text against the pane's select-none, or the caret cannot select what it is editing.
      className={cn(
        "mm-editor block w-full select-text resize-none overflow-hidden bg-transparent outline-none",
        // Source is typed as characters in fixed columns and read back by eye against what it will
        // render as, so it is not set in the label's proportional face.
        body === "code" && "whitespace-pre font-mono",
      )}
      defaultValue={plainText(element)}
      rows={1}
      spellCheck={false}
      style={fieldStyle(element, text.lines.length * text.lineHeight, isRoot)}
      onInput={(event) => {
        resize(event.currentTarget, { text: event.currentTarget.value })
        track(event.currentTarget.value)
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          // A composing Enter confirms the IME's candidate, not the label; let the IME answer it.
          if (event.nativeEvent.isComposing) {
            return
          }
          // Source is lines by definition, so Enter opens one rather than finishing the edit. A code
          // node is left with the modifier, with Escape, or by clicking away.
          if (body === "code" && !(event.ctrlKey || event.metaKey)) {
            event.stopPropagation()
            return
          }
          event.preventDefault()
          event.stopPropagation()
          finish(event.currentTarget.value)
          return
        }
        if (event.key === "Escape") {
          event.stopPropagation()
          finish(null)
          return
        }
        // Nothing to indent and nowhere to tab to. Left alone it would move focus out of the map.
        if (event.key === "Tab") {
          event.preventDefault()
        }
      }}
      onBlur={(event) => finish(event.currentTarget.value)}
      // A press inside the field is not a press on the canvas, which would clear the selection and
      // unmount the field before the caret ever moved.
      onPointerDown={(event) => event.stopPropagation()}
    />
  )
}

/**
 * A label that is its own to format: the notes editor once its chunk is here, the textarea until
 * then. The runs are what is tracked and what closes the field, whichever of the two is showing.
 */
function RunsField({ element, onEditEnd, onEditResize }: NodeEditorProps) {
  // What the field opened on. Read once: the element re-renders under an open field when the
  // branches follow its box, and the runs it opened on are not a thing that changes mid-edit.
  const opened = useRef<InlineSpan[] | null>(null)
  opened.current ??= [...(runsOf(element.content) ?? plainRuns(contentText(element.content) ?? ""))]
  const initial = opened.current

  const { finish, track } = useFieldFlush<InlineSpan[]>(initial, (value) =>
    onEditEnd?.(element.id, value === null ? null : { runs: value }),
  )
  const resize = useLiveBox(element, onEditResize)
  const [module, setModule] = useState<LabelEditorModule | null>(loadedLabelEditor)
  // What the textarea holds while the chunk is on its way, or null when nothing was typed into it.
  const typed = useRef<string | null>(null)
  // What the editor opens on, fixed the moment the chunk is here so a later render cannot reopen it.
  const opening = useRef<{ runs: InlineSpan[]; caret: "all" | "end" } | null>(null)

  useEffect(() => {
    if (module) {
      return
    }
    let live = true
    void loadLabelEditor().then((chunk) => {
      if (live) {
        setModule(chunk)
      }
    })
    return () => {
      live = false
    }
  }, [module])

  if (!module) {
    return (
      <StandInField
        element={element}
        text={flattenRuns(initial)}
        finish={finish}
        track={track}
        resize={resize}
        onType={(value) => {
          typed.current = value
        }}
        runsOf={() => (typed.current === null ? initial : plainRuns(typed.current))}
      />
    )
  }

  const carried = typed.current
  opening.current ??= {
    runs: carried === null ? initial : plainRuns(carried),
    caret: carried === null ? "all" : "end",
  }
  return (
    <RichField
      module={module}
      element={element}
      runs={opening.current.runs}
      caret={opening.current.caret}
      finish={finish}
      track={track}
      resize={resize}
    />
  )
}

/** The textarea a label shows until the editor chunk is here, closing with its text as one run. */
function StandInField({
  element,
  text,
  finish,
  track,
  resize,
  onType,
  runsOf,
}: {
  element: SceneElement
  text: string
  finish: FieldFlush<InlineSpan[]>["finish"]
  track: FieldFlush<InlineSpan[]>["track"]
  resize: LiveResize
  onType: (value: string) => void
  runsOf: () => InlineSpan[]
}) {
  const centred = element.isRoot || element.kind === "shape"
  const mount = useCallback(
    (node: HTMLTextAreaElement | null) => {
      if (!node) {
        return
      }
      node.focus({ preventScroll: true })
      node.select()
      resize(node, { text: node.value })
    },
    [resize],
  )

  return (
    <textarea
      ref={mount}
      className="mm-editor block w-full select-text resize-none overflow-hidden bg-transparent outline-none"
      defaultValue={text}
      rows={1}
      spellCheck={false}
      style={fieldStyle(element, element.text.lines.length * element.text.lineHeight, centred)}
      onInput={(event) => {
        onType(event.currentTarget.value)
        resize(event.currentTarget, { text: event.currentTarget.value })
        track(plainRuns(event.currentTarget.value))
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          if (event.nativeEvent.isComposing) {
            return
          }
          event.preventDefault()
          event.stopPropagation()
          finish(runsOf())
          return
        }
        if (event.key === "Escape") {
          event.stopPropagation()
          finish(null)
          return
        }
        if (event.key === "Tab") {
          event.preventDefault()
        }
      }}
      onBlur={() => finish(runsOf())}
      onPointerDown={(event) => event.stopPropagation()}
    />
  )
}

/**
 * The notes editor over the label's runs.
 *
 * The mount carries the label's metrics so the caret lands where the text was, the attribute the
 * interaction controller leaves alone, and the class the inline mark rules are scoped to. The view
 * is opened in a layout effect and torn down with it, so a strict-mode double invoke opens and
 * closes a whole editor and leaves nothing on the body.
 */
function RichField({
  module,
  element,
  runs,
  caret,
  finish,
  track,
  resize,
}: {
  module: LabelEditorModule
  element: SceneElement
  runs: InlineSpan[]
  caret: "all" | "end"
  finish: FieldFlush<InlineSpan[]>["finish"]
  track: FieldFlush<InlineSpan[]>["track"]
  resize: LiveResize
}) {
  const mount = useRef<HTMLDivElement>(null)
  const { text, padding } = element
  const centred = element.isRoot || element.kind === "shape"

  useLayoutEffect(() => {
    const host = mount.current
    if (!host) {
      return
    }
    const editor = module.openLabelEditor({
      mount: host,
      runs,
      caret,
      camera: cameraSignal,
      onChange: (next) => {
        track(next)
        resize(host, { text: flattenRuns(next), runs: next })
      },
      onFinish: (result) => {
        void finish(result)
      },
    })
    resize(host, { text: flattenRuns(runs), runs })
    return () => editor.destroy()
    // Every dependency is fixed for the life of the field, so this opens the editor once; a
    // re-render under the open field (the branches following its box) never reopens it.
  }, [module, runs, caret, finish, track, resize])

  return (
    <div
      ref={mount}
      data-mm-editor=""
      className="mm-editor inline-marks block w-full select-text whitespace-pre-wrap"
      style={{
        ...fieldStyle(element, undefined, centred),
        maxWidth: FONTS[fontScaleOf(text.fontSize)].maxWidth + padding.x * 2,
      }}
      // A press inside the field is not a press on the canvas, which would clear the selection and
      // unmount the field before the caret ever moved.
      onPointerDown={(event) => event.stopPropagation()}
    />
  )
}

/** The label's own metrics, on whichever field stands in its place. */
function fieldStyle(element: SceneElement, height: number | undefined, centred: boolean): React.CSSProperties {
  const { text } = element
  return {
    fontSize: text.fontSize,
    fontWeight: text.fontWeight,
    lineHeight: `${text.lineHeight}px`,
    letterSpacing: text.letterSpacing,
    color: element.textColor,
    paddingLeft: element.padding.x,
    paddingRight: element.padding.x,
    height,
    textAlign: centred ? "center" : undefined,
  }
}

/**
 * What the plain field opens on: the content's own text slot, not what was drawn.
 *
 * Code is drawn capped at eight lines and has to be edited whole; a link is drawn as its address and
 * edited as its title. Falling back to the drawn lines only covers the kinds that carry no text at
 * all, which are the ones this field never opens on.
 */
function plainText(element: SceneElement): string {
  return contentText(element.content) ?? element.text.lines.join(" ")
}
