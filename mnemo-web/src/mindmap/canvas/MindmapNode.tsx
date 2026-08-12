import { memo, useCallback, useEffect, useRef } from "react"
import "katex/dist/katex.min.css"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"
import { renderMath } from "@/notes/editor/atoms/katex"

import { useMindmapImage } from "../assets"
import { bodyOf, imageRefOf, refGlyphOf, type ImageRef } from "../scene/content"
import { FRAME_HEAD } from "../scene/project"
import { branchWash, mixColor } from "../scene/tokens"
import {
  contentText,
  type CodeContent,
  type FrameContent,
  type MathContent,
} from "../model/document"
import type { ShapeContent, ShapeType } from "../model/document"
import type { SceneElement } from "../model/scene"
import { isOpenShape, shapePath, shapeTextInset } from "./shape-path"

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
  const t = useT()
  const { nodeShape, isRoot } = element
  const tinted = element.branchColor !== undefined
  const accentLine = element.branchColor ?? element.stroke

  // A frame is a region rather than a thing with a label in the middle, so none of what follows
  // applies to it: no card, no halo bled around the box, and a hit target that is not the whole area.
  if (element.kind === "frame") {
    return <FrameBody element={element} editing={editing} onEditEnd={onEditEnd} />
  }

  return (
    <div
      className="mm-node group absolute left-0 top-0 select-none will-change-transform"
      data-mm-id={element.id}
      style={{
        transform: `translate(${element.x}px, ${element.y}px)`,
        width: element.width,
        height: element.height,
        // Read only below the label threshold, where the host is the only box left to paint. Set
        // here rather than in the stylesheet because it is per element, and written once at render
        // rather than per frame, so a band crossing stays one style recalculation.
        "--mm-marker": markerFill(element, tinted, accentLine),
      } as React.CSSProperties}
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

      {element.kind === "shape" ? <ShapeOutline element={element} stroke={accentLine} /> : null}

      {isResizable(element) && !editing ? <ResizeHandles /> : null}

      <div
        className={cn(
          "relative flex h-full w-full items-center",
          isRoot && "justify-center rounded-[14px]",
          element.kind === "shape" && "justify-center",
          !isRoot && nodeShape === "pill" && "rounded-full",
          !isRoot && (nodeShape === "card" || nodeShape === "outline") && "rounded-[10px]",
        )}
        style={bodyStyle(element, tinted, accentLine)}
      >
        <NodeGlyph element={element} accent={accentLine} label={t("Mindmap", "OpenRef")} />

        {element.content.$type === "task" ? (
          <span
            data-mm-chrome="task"
            className={cn(
              "mm-chrome ml-2 grid size-[13px] shrink-0 cursor-pointer place-items-center rounded-[4px]",
              "shadow-[inset_0_0_0_1.5px_currentColor]",
            )}
            style={{ color: accentLine }}
            title={t("Mindmap", "ToggleTask")}
          >
            {isDone(element) ? <AppIcon name="check" size={9} strokeWidth={2.5} /> : null}
          </span>
        ) : null}

        {editing ? <NodeEditor element={element} onEditEnd={onEditEnd} /> : <NodeBody element={element} />}

        {element.refBadge ? (
          <span
            className="mm-chrome pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full px-1.5 text-[9.5px] font-medium leading-[14px] text-canvas"
            style={{ background: accentLine ?? "var(--ink-3)" }}
          >
            {element.refBadge}
          </span>
        ) : null}

        {/* Over the source rather than beside it, because the box was measured around the code and
            a chip that took room of its own would widen every code node by the length of the word
            "javascript". It paints the body's own colour behind itself so the line it covers ends
            rather than runs under it. */}
        {codeLanguage(element) ? (
          <span
            className="mm-chrome pointer-events-none absolute rounded-[3px] px-1 font-mono text-[9.5px] leading-[13px] text-ink-3"
            style={{
              top: element.padding.y,
              right: element.padding.x,
              background: surfaceOf(element, tinted),
            }}
          >
            {codeLanguage(element)}
          </span>
        ) : null}
      </div>

      {/* A dot in the corner, and pressing it lets go. A pin is easy to acquire without meaning to,
          since dragging a node anywhere makes one, so the node that will sit out the next arrange has
          to say so where it stands rather than only once you have selected it. */}
      {element.kind === "node" && element.pinned ? (
        <span
          data-mm-chrome="pin"
          title={t("Mindmap", "TogglePin")}
          className="mm-chrome absolute right-px top-px grid size-4 cursor-pointer place-items-center"
        >
          <span
            className="size-[9px] rounded-full"
            style={{ background: element.textColor ?? "var(--ink)" }}
          />
        </span>
      ) : null}

      {element.hiddenCount > 0 ? (
        <span
          className="mm-chrome absolute -right-1 top-1/2 -translate-y-1/2 translate-x-full rounded-full px-1.5 text-[10px] font-medium leading-[15px] text-canvas"
          style={{ background: accentLine }}
        >
          {element.hiddenCount}
        </span>
      ) : null}
    </div>
  )
})

/**
 * The mark before the text.
 *
 * One slot, two sources. A style can put any icon on any node, and a reference brings a mark of its
 * own saying what it points at; when both are there the style wins, because that one was asked for.
 *
 * A reference's mark is also its handle: pressing it follows the reference, which is the one gesture
 * on a node that does something other than select it. That is why it carries the chrome attribute
 * even when the glyph on it came from a style, and why a node that is not a reference never does.
 */
function NodeGlyph({
  element,
  accent,
  label,
}: {
  element: SceneElement
  accent: string | undefined
  label: string
}) {
  const refGlyph = refGlyphOf(element.content)
  const glyph = element.icon ?? refGlyph
  if (!glyph) {
    return null
  }

  if (!refGlyph) {
    return <AppIcon name={glyph} size={13} strokeWidth={1.6} className="mm-chrome ml-2 shrink-0 text-ink-icon" />
  }

  return (
    <span
      data-mm-chrome="ref"
      className="mm-chrome ml-1.5 shrink-0 cursor-pointer hover:opacity-70"
      style={{ color: element.refMissing ? undefined : accent }}
      title={label}
    >
      <AppIcon
        name={glyph}
        size={14}
        strokeWidth={1.6}
        className={cn("block", element.refMissing && "text-ink-3")}
      />
    </span>
  )
}

/** What a node draws in the space its box was measured around. */
function NodeBody({ element }: { element: SceneElement }) {
  const image = imageRefOf(element.content)
  if (image) {
    return <ImageBody image={image} />
  }
  switch (bodyOf(element.content)) {
    case "code":
      return <CodeBody element={element} />
    case "math":
      return <MathBody element={element} />
    default:
      return <NodeLabel element={element} />
  }
}

/**
 * The label: the lines the projector wrapped, set with the metrics it wrapped them at.
 *
 * Never re-wrapped. The projector already decided where the lines break, and the box was measured
 * against that decision; letting CSS wrap again means a label one pixel wider than measured spills
 * onto a second line inside a box built for one. Every single-word label hides this, and every label
 * with a space in it finds it.
 */
function NodeLabel({ element }: { element: SceneElement }) {
  const { text } = element
  const done = isDone(element)
  // A finished task and a reference to something deleted are both text that is still there and no
  // longer current. Said with weight rather than with a colour of their own, so a node that was
  // given a colour keeps reading as that colour.
  const faded = done || element.refMissing === true

  return (
    <span
      className={cn(
        "mm-label block w-full",
        (element.isRoot || element.kind === "shape") && "text-center",
        faded && "text-ink-3",
        done && "line-through",
        element.refMissing && "italic",
      )}
      style={{
        fontSize: text.fontSize,
        fontWeight: text.fontWeight,
        lineHeight: `${text.lineHeight}px`,
        letterSpacing: text.letterSpacing,
        color: faded ? undefined : element.textColor,
        paddingLeft: element.padding.x + labelInset(element),
        paddingRight: element.padding.x + labelInset(element),
      }}
    >
      {text.lines.map((line, index) => (
        <span key={index} className="block whitespace-pre">
          {line}
        </span>
      ))}
    </span>
  )
}

/**
 * Source, as typed.
 *
 * Not wrapped and not re-indented: indentation is what makes code readable, and a wrap loses it. A
 * line wider than the box is cut off at the edge instead, which is the same call the measurement
 * makes when it caps the box at eight lines.
 */
function CodeBody({ element }: { element: SceneElement }) {
  const { text } = element

  return (
    <span
      className="mm-label block w-full overflow-hidden font-mono"
      style={{
        fontSize: text.fontSize,
        fontWeight: text.fontWeight,
        lineHeight: `${text.lineHeight}px`,
        color: element.textColor,
        paddingLeft: element.padding.x,
        paddingRight: element.padding.x,
      }}
    >
      {text.lines.map((line, index) => (
        <span key={index} className="block whitespace-pre">
          {line}
        </span>
      ))}
    </span>
  )
}

/**
 * An equation, rendered.
 *
 * Written to the DOM by KaTeX rather than described as JSX, so this is one of the few places on the
 * canvas React does not own the subtree. It carries the same class and the same font size the
 * measurer used on its offscreen host, which is what makes the box the layout packed match the box
 * that lands in it.
 */
function MathBody({ element }: { element: SceneElement }) {
  const host = useRef<HTMLSpanElement>(null)
  const latex = (element.content as MathContent).latex ?? ""

  useEffect(() => {
    if (host.current) {
      // The source doubles as the accessible label, which is what a screen reader should hear: it is
      // what the user wrote, and the rendering is a picture of it.
      renderMath(host.current, latex, latex)
    }
  }, [latex])

  return (
    <span
      ref={host}
      className="mm-math mm-label block w-full overflow-hidden whitespace-nowrap text-center"
      style={{
        fontSize: element.text.fontSize,
        color: element.textColor,
        paddingLeft: element.padding.x,
        paddingRight: element.padding.x,
      }}
    />
  )
}

/**
 * A picture, drawn to the box it was given.
 *
 * Stretched rather than fitted, which is what the desktop does: the box arrives at the picture's own
 * proportions, so the only way to distort one is to drag a corner and ask for it.
 *
 * The bytes sit behind the API's token, so they come through a fetch and arrive as a blob URL rather
 * than as an address the element could carry. Nothing is drawn while they are in flight and a
 * placeholder is drawn once the answer comes back empty, because an asset that is genuinely gone has
 * to say so: an image element drawing nothing at all is indistinguishable from a blank one.
 */
function ImageBody({ image }: { image: ImageRef }) {
  const t = useT()
  const { url, missing } = useMindmapImage(image.assetId)

  if (url) {
    return (
      <img
        src={url}
        // The caption when it has one, and nothing to announce when it does not.
        alt={image.caption ?? ""}
        // Or the browser's own image drag would start instead of the gesture the canvas is running.
        draggable={false}
        className="pointer-events-none block h-full w-full rounded-[6px] border border-line-soft object-fill"
      />
    )
  }

  return (
    <span
      className={cn(
        "grid h-full w-full place-items-center overflow-hidden rounded-[6px] px-2",
        "text-center text-[11px] text-ink-3",
        missing ? "border border-dashed border-line bg-frame-hover" : "bg-frame-hover",
      )}
    >
      {missing ? t("Mindmap", "ImageMissing") : null}
    </span>
  )
}

function isDone(element: SceneElement): boolean {
  return element.content.$type === "task" && (element.content as { done?: boolean }).done === true
}

/** The chip a code node wears, or nothing when its language was never said. */
function codeLanguage(element: SceneElement): string | null {
  if (element.content.$type !== "code") {
    return null
  }
  return (element.content as CodeContent).language?.trim() || null
}

/**
 * The colour the body was painted, for the chrome that has to sit on top of the text rather than
 * beside it. Falls back to the canvas, which is what a node with no fill of its own is showing.
 */
function surfaceOf(element: SceneElement, tinted: boolean): string {
  if (!element.isRoot && element.nodeShape === "pill" && tinted) {
    return branchWash(element.branch)
  }
  return element.fill ?? "var(--canvas)"
}

/**
 * The one colour an element reads as when it is a few pixels across.
 *
 * Below the label threshold every box inside a node is taken out of the layout, so the host is the
 * only thing left to paint and it has to stand for whatever the node would have drawn: a card's
 * fill, a plain node's rule, a shape's outline, a caption's ink. Falling back to the line colour
 * keeps an element with no colour of its own from disappearing into the canvas.
 */
function markerFill(
  element: SceneElement,
  tinted: boolean,
  accentLine: string | undefined,
): string {
  // A picture is gone at this size and there is nothing sensible to average it to, so it marks its
  // place the way anything else without a colour does.
  if (element.kind === "image") {
    return "var(--line)"
  }
  if (element.kind === "text") {
    return element.textColor ?? "var(--ink-3)"
  }
  if (element.kind === "shape") {
    return element.fill ?? accentLine ?? "var(--line)"
  }
  if (element.isRoot) {
    return element.fill ?? "var(--accent)"
  }

  switch (element.nodeShape) {
    case "pill":
      return tinted ? branchWash(element.branch) : (element.fill ?? accentLine ?? "var(--line)")
    // Both draw their whole chrome as a line, so the line is what they are.
    case "plain":
    case "outline":
      return accentLine ?? "var(--line)"
    default:
      return element.fill ?? accentLine ?? "var(--line)"
  }
}

/**
 * Which elements can be dragged to a size.
 *
 * The free ones, and only those. A node's box is measured around its wrapped label, so a stored
 * width would be a box that no longer says anything about the text inside it; a frame's box is
 * derived from its members, so a handle on one would be a number the next member to move overwrites.
 * Both of those are things to say with a different gesture, not with a grip on a corner.
 */
function isResizable(element: SceneElement): boolean {
  return element.kind === "shape" || element.kind === "text" || element.kind === "image"
}

/** The eight grips, as fractions of the box, with the cursor each one should show. */
const HANDLES = [
  { dir: "nw", x: 0, y: 0, cursor: "nwse-resize" },
  { dir: "n", x: 0.5, y: 0, cursor: "ns-resize" },
  { dir: "ne", x: 1, y: 0, cursor: "nesw-resize" },
  { dir: "e", x: 1, y: 0.5, cursor: "ew-resize" },
  { dir: "se", x: 1, y: 1, cursor: "nwse-resize" },
  { dir: "s", x: 0.5, y: 1, cursor: "ns-resize" },
  { dir: "sw", x: 0, y: 1, cursor: "nesw-resize" },
  { dir: "w", x: 0, y: 0.5, cursor: "ew-resize" },
] as const

/**
 * The grips on a selected free element.
 *
 * Drawn inside the host rather than in an overlay, so they travel with the box for free while the
 * resize itself is written to the DOM: an overlay would need its own copy of the geometry, updated
 * on every frame of the gesture, and the two would drift the first time one of them was missed.
 *
 * They undo the camera's scale on themselves, since a grip that shrinks with the map is a grip you
 * cannot hit when zoomed out. The scale arrives as a custom property the scene index writes onto
 * the selected hosts, and the whole undo is one transform, so the border and the radius stay the
 * size they were drawn at too.
 *
 * Only while exactly one thing is selected. Eight grips on every member of a sweep is noise, and
 * there is no sensible answer for what one of them would do to a set.
 */
function ResizeHandles() {
  return (
    <>
      {HANDLES.map((handle) => (
        <span
          key={handle.dir}
          data-mm-handle={handle.dir}
          className={cn(
            "absolute hidden size-[9px] rounded-[2px] border border-accent bg-canvas",
            "group-data-[selected=one]:block",
          )}
          style={{
            left: `${handle.x * 100}%`,
            top: `${handle.y * 100}%`,
            transform: "translate(-50%, -50%) scale(calc(1 / var(--mm-zoom, 1)))",
            cursor: handle.cursor,
          }}
          aria-hidden
        />
      ))}
    </>
  )
}

/** How wide a band along a frame's border can be grabbed, on top of its title strip. */
const FRAME_GRIP = 12

/**
 * A frame: a dashed region around the things it holds.
 *
 * It takes pointer events on its title strip and on a band just inside its border, and nowhere else.
 * A frame is mostly empty space with other people's nodes in it, and one that swallowed presses over
 * its whole area would be a region you could not start a marquee inside, could not click through to
 * the canvas in, and would drag every time you meant to catch two of its members.
 *
 * Nothing here is sized: the box arrives already derived from the members, so what this draws is
 * always around what the frame actually holds rather than around wherever a stored rectangle was left.
 */
function FrameBody({ element, editing, onEditEnd }: MindmapNodeProps) {
  const hue = element.branchColor ?? element.stroke
  const title = (element.content as FrameContent).title ?? ""

  return (
    <div
      className="mm-node mm-frame group pointer-events-none absolute left-0 top-0 select-none will-change-transform"
      data-mm-id={element.id}
      style={{
        transform: `translate(${element.x}px, ${element.y}px)`,
        width: element.width,
        height: element.height,
      }}
    >
      {/* Two borders rather than one, for the same reason a node has two halos: the selected state is
          a DOM attribute the scene index writes, so it cannot be branched on here, and an inline
          colour would win over whatever class tried to change it. */}
      <span
        className="absolute inset-0 rounded-2xl border border-dashed border-line group-data-[selected]:hidden"
        style={{ borderColor: hue ? mixColor(hue, 55) : undefined }}
        aria-hidden
      />
      <span
        className="absolute inset-0 hidden rounded-2xl border border-dashed border-accent group-data-[selected]:block"
        aria-hidden
      />

      {/* The grips. Bands rather than the whole box, and siblings rather than one padded element,
          because a child that turns pointer events off does not hand them back to the canvas behind
          it, it hands them to its own parent. */}
      <span className="pointer-events-auto absolute inset-x-0 top-0" style={{ height: FRAME_HEAD }} />
      <span className="pointer-events-auto absolute bottom-0 left-0 top-0" style={{ width: FRAME_GRIP }} />
      <span className="pointer-events-auto absolute bottom-0 right-0 top-0" style={{ width: FRAME_GRIP }} />
      <span className="pointer-events-auto absolute inset-x-0 bottom-0" style={{ height: FRAME_GRIP }} />

      {editing ? (
        <FrameTitle element={element} title={title} onEditEnd={onEditEnd} />
      ) : (
        <span
          className="mm-label absolute left-3 top-[3px] text-[11px] font-medium tracking-[0.01em] text-ink-2"
          style={{ color: hue }}
        >
          {title}
          <span className="ml-1.5 text-ink-3">{element.childCount}</span>
        </span>
      )}
    </div>
  )
}

/**
 * The title, as a field.
 *
 * Its own rather than the node editor, because a frame's label is chrome at a fixed size in a corner
 * of the region, not text the box was measured around, and there is no second line to grow onto.
 */
function FrameTitle({
  element,
  title,
  onEditEnd,
}: {
  element: SceneElement
  title: string
  onEditEnd?: (id: string, text: string | null) => void
}) {
  const done = useRef(false)

  const finish = (value: string | null): void => {
    if (done.current) {
      return
    }
    done.current = true
    onEditEnd?.(element.id, value)
  }

  return (
    <input
      ref={(node) => node?.select()}
      autoFocus
      className="mm-editor pointer-events-auto absolute left-3 top-[3px] w-[60%] select-text bg-transparent text-[11px] font-medium tracking-[0.01em] text-ink outline-none"
      defaultValue={title}
      spellCheck={false}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault()
          event.stopPropagation()
          finish(event.currentTarget.value)
          return
        }
        if (event.key === "Escape") {
          event.stopPropagation()
          finish(null)
        }
      }}
      onBlur={(event) => finish(event.currentTarget.value)}
      onPointerDown={(event) => event.stopPropagation()}
    />
  )
}

/**
 * A free shape's outline.
 *
 * Drawn as one path in its own SVG sized to the box rather than as a div with a border, because five
 * of the seven are not rectangles and CSS has no honest way to say diamond. It sits behind the label
 * and takes no pointer events, so the host div stays the only thing a gesture can land on and the
 * hit target is the box rather than the outline's own irregular area.
 */
function ShapeOutline({ element, stroke }: { element: SceneElement; stroke: string | undefined }) {
  const shape = (element.content as ShapeContent).shape ?? DEFAULT_SHAPE
  const open = isOpenShape(shape)

  return (
    <svg
      className="pointer-events-none absolute inset-0 overflow-visible"
      width={element.width}
      height={element.height}
      aria-hidden
    >
      <path
        // Named so a live resize can redraw the path from the DOM. The outline is drawn to the box
        // rather than scaled into it, so it cannot simply follow a size the gesture wrote.
        data-mm-shape={shape}
        d={shapePath(shape, element.width, element.height)}
        fill={open ? "none" : (element.fill ?? "var(--canvas)")}
        stroke={stroke ?? "var(--line)"}
        strokeWidth={1.5}
        strokeLinejoin="round"
        // An arrow shape's head is the marker the edge layer already defines, so a shape arrow and
        // an edge's arrow are the same glyph rather than two drawings of one idea.
        markerEnd={shape === "arrow" ? "url(#mm-cap-arrow)" : undefined}
      />
    </svg>
  )
}

/** What a shape is when its content never said. Every other kind has a real default of its own. */
const DEFAULT_SHAPE: ShapeType = "rectangle"

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
  const body = bodyOf(element.content)
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
      className={cn(
        "mm-editor block w-full select-text resize-none overflow-hidden bg-transparent outline-none",
        // Source and LaTeX are both typed as characters in fixed columns, and both are read back by
        // eye against what they will render as, so neither is set in the label's proportional face.
        body !== "label" && "whitespace-pre font-mono",
      )}
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

/** The field grows with what is typed, since the box itself is only remeasured on commit. */
function grow(node: HTMLTextAreaElement): void {
  node.style.height = "0px"
  node.style.height = `${node.scrollHeight}px`
}

/**
 * How far a label has to come in from the box before the outline stops cutting through it.
 *
 * Zero for everything but a shape, where the box is a bounding box rather than the drawn area: a
 * diamond's corners are the only part of its box that reaches the edge, and text set to the box would
 * run straight out through its sides.
 */
function labelInset(element: SceneElement): number {
  if (element.kind !== "shape") {
    return 0
  }
  const shape = (element.content as ShapeContent).shape ?? DEFAULT_SHAPE
  return shapeTextInset(shape, element.width, element.height).x
}

/**
 * What the field opens on: the content's own text slot, not what was drawn.
 *
 * The two are different for more kinds than they are the same. Code is drawn capped at eight lines
 * and has to be edited whole; a link is drawn as its address and edited as its title; an equation is
 * drawn as a rendering and edited as its source. Falling back to the drawn lines only covers the
 * kinds that carry no text at all, which are the ones this field never opens on.
 */
function plainText(element: SceneElement): string {
  return contentText(element.content) ?? element.text.lines.join(" ")
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
  // annotation look like something the map connects to. A shape has already drawn its own outline,
  // and a picture is its own box: a card behind one is a rim nobody asked for around every photo.
  if (element.kind === "text" || element.kind === "shape" || element.kind === "image") {
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
