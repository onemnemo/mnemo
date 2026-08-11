import { memo, useCallback, useRef } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { cn } from "@/lib/utils"

import { branchWash, mixColor } from "../scene/tokens"
import type { SceneElement } from "../model/scene"

export interface MindmapNodeProps {
  element: SceneElement
  /** This node's label is being typed into. Only ever true for one node at a time. */
  editing?: boolean
  /** The typed text, or null when the edit was abandoned. */
  onEditEnd?: (id: string, text: string | null) => void
}

/**
 * One element on the canvas.
 *
 * The shape ladder is a ladder of loudness, not a shape picker: no chrome, a tint, a card, an
 * outline. Diamonds and hexagons are flowchart vocabulary, and in a mindmap nobody can say what a
 * hexagon means. Which rung a node lands on is the cascade's answer, already resolved before this
 * component sees it, so there is no styling logic here beyond turning that answer into CSS.
 *
 * The host carries the class and data attribute the scene index looks for, and its transform is the
 * only thing that moves during a drag. React renders this once per scene; the camera and every
 * position after the first are written straight to the DOM, because a position that lives in a
 * component is a position that costs a render to change.
 *
 * Hover, selection and editing are all drawn without touching the box, either as decorative spans
 * bled outside it or, for the editor, as a field standing exactly where the label stood. Anything
 * that changed the box would move the node the moment you pointed at it.
 */
export const MindmapNode = memo(function MindmapNode({ element, editing, onEditEnd }: MindmapNodeProps) {
  const { text, nodeShape, isRoot } = element
  const tinted = element.branchColor !== undefined
  const accentLine = element.branchColor ?? element.stroke

  return (
    <div
      className="mm-node group absolute left-0 top-0 select-none will-change-transform"
      data-mm-id={element.id}
      style={{
        transform: `translate(${element.x}px, ${element.y}px)`,
        width: element.width,
        height: element.height,
      }}
    >
      {/* Two spans rather than one with conflicting variants: the ring's state is a DOM attribute
          the scene index writes, so it cannot be branched on in JavaScript, and hover and selection
          would otherwise be two utilities fighting over one property in whatever order Tailwind
          happened to emit them. Both are bled outside the box on both axes so they read as a halo
          around the node rather than as a second box drawn on it, and so a plain node with no
          chrome of its own still gets one. */}
      <span
        className={cn(
          "pointer-events-none absolute -inset-x-1.5 -inset-y-1 rounded-[10px] transition-colors duration-100",
          "group-hover:bg-frame-hover group-data-[selected]:hidden",
          editing && "hidden",
        )}
        aria-hidden
      />
      <span
        className={cn(
          "pointer-events-none absolute -inset-x-1.5 -inset-y-1 rounded-[10px] outline-2 outline-accent",
          editing ? "block" : "hidden group-data-[selected]:block",
        )}
        aria-hidden
      />

      <div
        className={cn(
          "relative flex h-full w-full items-center",
          isRoot && "justify-center rounded-[14px]",
          !isRoot && nodeShape === "pill" && "rounded-full",
          !isRoot && (nodeShape === "card" || nodeShape === "outline") && "rounded-[10px]",
        )}
        style={bodyStyle(element, tinted, accentLine)}
      >
        {element.icon ? (
          <AppIcon name={element.icon} size={13} strokeWidth={1.6} className="ml-2 shrink-0 text-ink-icon" />
        ) : null}

        {element.content.$type === "task" ? (
          <span
            className={cn(
              "ml-2 grid size-[13px] shrink-0 place-items-center rounded-[4px]",
              "shadow-[inset_0_0_0_1.5px_currentColor]",
            )}
            style={{ color: accentLine }}
          >
            {(element.content as { done?: boolean }).done ? (
              <AppIcon name="check" size={9} strokeWidth={2.5} />
            ) : null}
          </span>
        ) : null}

        {editing ? (
          <NodeEditor element={element} onEditEnd={onEditEnd} />
        ) : (
          <span
            className={cn("mm-label block w-full", isRoot && "text-center")}
            style={{
              fontSize: text.fontSize,
              fontWeight: text.fontWeight,
              lineHeight: `${text.lineHeight}px`,
              letterSpacing: text.letterSpacing,
              color: element.textColor,
              paddingLeft: element.padding.x,
              paddingRight: element.padding.x,
            }}
          >
            {/* Never re-wrapped. The projector already decided where the lines break, and the box
                was measured against that decision; letting CSS wrap again means a label one pixel
                wider than measured spills onto a second line inside a box built for one. Every
                single-word label hides this, and every label with a space in it finds it. */}
            {text.lines.map((line, index) => (
              <span key={index} className="block whitespace-pre">
                {line}
              </span>
            ))}
          </span>
        )}
      </div>

      {element.hiddenCount > 0 ? (
        <span
          className="absolute -right-1 top-1/2 -translate-y-1/2 translate-x-full rounded-full px-1.5 text-[10px] font-medium leading-[15px] text-canvas"
          style={{ background: accentLine }}
        >
          {element.hiddenCount}
        </span>
      ) : null}
    </div>
  )
})

/**
 * The label, as a field.
 *
 * Rendered in the label's own place inside the node rather than as an overlay positioned to match
 * it, so "nothing jumps when you start typing" is true by construction rather than by two sets of
 * numbers agreeing. It carries the same metrics the projector measured the box with, which is why
 * the caret lands exactly where the text was.
 *
 * Uncontrolled on purpose: a controlled value would cost a render of the canvas subtree per
 * keystroke to move a caret, and nothing outside this field needs to see the text until it is done.
 */
function NodeEditor({
  element,
  onEditEnd,
}: {
  element: SceneElement
  onEditEnd?: (id: string, text: string | null) => void
}) {
  const { text, isRoot } = element
  // A cancel blurs the field, and the blur must not then commit what the cancel just threw away.
  const done = useRef(false)

  const mount = useCallback((node: HTMLTextAreaElement | null) => {
    if (!node) {
      return
    }
    node.focus({ preventScroll: true })
    node.select()
    grow(node)
  }, [])

  const finish = (value: string | null): void => {
    if (done.current) {
      return
    }
    done.current = true
    onEditEnd?.(element.id, value)
  }

  return (
    <textarea
      ref={mount}
      // select-text against the pane's select-none, or the caret cannot select what it is editing.
      className="mm-editor block w-full select-text resize-none overflow-hidden bg-transparent outline-none"
      defaultValue={plainText(element)}
      rows={1}
      spellCheck={false}
      style={{
        fontSize: text.fontSize,
        fontWeight: text.fontWeight,
        lineHeight: `${text.lineHeight}px`,
        letterSpacing: text.letterSpacing,
        color: element.textColor,
        paddingLeft: element.padding.x,
        paddingRight: element.padding.x,
        height: text.lines.length * text.lineHeight,
        textAlign: isRoot ? "center" : undefined,
      }}
      onInput={(event) => grow(event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
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

/** The field grows with what is typed, since the box itself is only remeasured on commit. */
function grow(node: HTMLTextAreaElement): void {
  node.style.height = "0px"
  node.style.height = `${node.scrollHeight}px`
}

/** What was wrapped for drawing, joined back into what was typed. */
function plainText(element: SceneElement): string {
  const content = element.content as { text?: string }
  return content.text ?? element.text.lines.join(" ")
}

/**
 * A plain node has no box at all: its rule is its whole chrome, and the branch that arrives lands on
 * that rule rather than on an invisible bounding box.
 */
function bodyStyle(
  element: SceneElement,
  tinted: boolean,
  accentLine: string | undefined,
): React.CSSProperties {
  // A caption is words on the canvas rather than a node on it. Giving it a card would make every
  // annotation look like something the map connects to.
  if (element.kind === "text") {
    return {}
  }

  if (element.isRoot) {
    return {
      background: element.fill,
      boxShadow: "0 1px 2px oklch(0 0 0 / 0.12), 0 4px 12px -4px oklch(0 0 0 / 0.18)",
    }
  }

  switch (element.nodeShape) {
    case "plain":
      return { borderBottom: `${element.underline ?? 2}px solid ${accentLine ?? "var(--line)"}` }
    case "pill":
      return {
        background: tinted ? branchWash(element.branch) : element.fill,
        boxShadow: accentLine ? `inset 0 0 0 1px ${mixColor(accentLine, 16)}` : undefined,
      }
    case "outline":
      return { boxShadow: `inset 0 0 0 1px ${accentLine ?? "var(--line)"}` }
    default:
      return {
        background: element.fill,
        boxShadow: accentLine
          ? `0 0 0 1px ${mixColor(accentLine, 32)}, 0 1px 2px oklch(0 0 0 / 0.05)`
          : "0 0 0 1px var(--line-soft), 0 1px 2px oklch(0 0 0 / 0.05)",
      }
  }
}
