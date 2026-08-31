/**
 * The map as a picture.
 *
 * Drawn from the scene rather than from the DOM, so an export goes through the same projector the
 * canvas does and cannot show a different layout, a different branch colour or a different edge from
 * the map it was taken of. It is also why this is a browser-side job in the first place: a box's size
 * is the width its label came out at, and only the machine with the fonts on it knows that.
 *
 * Pure. Everything that needs a document, resolving a colour and measuring a chip, arrives as a
 * function, which is what lets the whole emitter be tested without one.
 *
 * Two things on the canvas are deliberately not here. Icons need the app's sprite, and a wrong glyph
 * is worse than none, so the space a node reserved for one is left blank. An equation falls back to
 * its own source in italics, since a rendered equation is a KaTeX subtree carrying KaTeX's stylesheet
 * and neither survives leaving the app. The desktop exporter makes both of the same calls.
 */

import { strokeFor } from "../canvas/edge-canvas"
import {
  anchorsFor,
  boxOf,
  capsOf,
  edgeShape,
  isFilled,
  strokeToPathData,
  type CapPlacement,
} from "../canvas/edge-paths"
import { dashAttribute, strokeStyleFor } from "../canvas/edge-style"
import { isOpenShape, shapePath } from "../canvas/shape-path"
import { bodyOf, imageRefOf, refGlyphOf, type ImageRef } from "../scene/content"
import { FONT_FAMILY, MONO_FAMILY, type TextMeasurer } from "../scene/measure"
import { accentOf } from "../scene/branch"
import { mixColor, washOf } from "../scene/tokens"
import { boundsOf, type Scene, type SceneEdge, type SceneElement } from "../model/scene"
import type { ArrowCap, CodeContent, FrameContent, ShapeContent, ShapeType } from "../model/document"

/** Room around the drawing, the same as the desktop leaves. */
export const EXPORT_MARGIN = 48

export interface SvgOptions {
  /** Every colour leaves through here, turned from theme language into a literal. */
  readonly color: (css: string) => string
  /** Measures the chrome the projector never sized a box around: chips, badges, frame titles. */
  readonly measure: TextMeasurer
  /** The same, for the one chip set in the mono face. */
  readonly measureMono: TextMeasurer
  /** The paper. Null leaves the picture transparent. */
  readonly background: string | null
  readonly margin?: number
  /** CSS put in the file's own stylesheet, which is how the raster path carries its fonts. */
  readonly style?: string
  /**
   * An asset id turned into something the file can carry, which in practice is a data URI.
   *
   * Resolved by the caller rather than here because this stays pure and synchronous, and bytes have
   * to be fetched. Null for a picture that could not be read, and absent when the caller does not
   * deal in pictures at all; both draw the same empty box.
   */
  readonly image?: (assetId: string) => string | null
}

export interface SvgPicture {
  readonly markup: string
  readonly width: number
  readonly height: number
}

interface Paint {
  readonly color: (css: string) => string
  readonly measure: TextMeasurer
  readonly measureMono: TextMeasurer
  readonly image?: (assetId: string) => string | null
}

export function emitSvg(scene: Scene, options: SvgOptions): SvgPicture | null {
  if (scene.elements.length === 0) {
    return null
  }

  const margin = options.margin ?? EXPORT_MARGIN
  const bounds = boundsOf(scene.elements)
  const minX = bounds.minX - margin
  const minY = bounds.minY - margin
  const width = Math.max(1, Math.ceil(bounds.maxX - bounds.minX + margin * 2))
  const height = Math.max(1, Math.ceil(bounds.maxY - bounds.minY + margin * 2))

  const paint: Paint = {
    color: options.color,
    measure: options.measure,
    measureMono: options.measureMono,
    image: options.image,
  }
  const boxes = new Map(scene.elements.map((element) => [element.id, element]))

  const body: string[] = []
  // Edges first, for the same reason the canvas puts its edge layer under the nodes: a branch runs to
  // the middle of the box it joins, and drawn last it would run over the label there.
  for (const edge of scene.edges) {
    const from = boxes.get(edge.fromId)
    const to = boxes.get(edge.toId)
    if (from && to) {
      body.push(emitEdge(edge, from, to, paint))
    }
  }
  for (const element of scene.elements) {
    body.push(emitElement(element, paint))
  }

  const defs: string[] = []
  if (options.style) {
    defs.push(`<style>${options.style}</style>`)
  }
  // Only a root on the card rung is drawn with it, and a map whose root is a rule or a pill would
  // otherwise carry a filter nothing references.
  if (scene.elements.some((element) => element.isRoot && element.nodeShape === "card")) {
    defs.push(ROOT_SHADOW)
  }

  const markup =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"` +
    ` viewBox="${n(minX)} ${n(minY)} ${width} ${height}">` +
    (defs.length > 0 ? `<defs>${defs.join("")}</defs>` : "") +
    (options.background === null
      ? ""
      : `<rect x="${n(minX)}" y="${n(minY)}" width="${width}" height="${height}" fill="${paint.color(
          options.background,
        )}"/>`) +
    body.join("") +
    "</svg>"

  return { markup, width, height }
}

const ROOT_SHADOW =
  '<filter id="mm-root-shadow" x="-25%" y="-25%" width="150%" height="150%">' +
  '<feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000000" flood-opacity="0.14"/></filter>'

/* -------------------------------------------------------------------------- */
/* Edges                                                                      */
/* -------------------------------------------------------------------------- */

function emitEdge(edge: SceneEdge, from: SceneElement, to: SceneElement, paint: Paint): string {
  const anchors = anchorsFor(boxOf(from), boxOf(to))
  const stroke = strokeFor(edge, anchors)
  const style = strokeStyleFor(edge)
  const color = paint.color(style.color)
  const out: string[] = []

  // A ribbon is a closed shape, so it is filled and never stroked; stroking one outlines it instead
  // of filling it, and filling an open curve closes it into a lens.
  if (isFilled(stroke)) {
    out.push(`<path d="${strokeToPathData(stroke)}" fill="${color}"/>`)
  } else {
    const dash = dashAttribute(style.dash)
    out.push(
      `<path d="${strokeToPathData(stroke)}" fill="none" stroke="${color}" stroke-width="${n(style.width)}"` +
        ` stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`,
    )

    // Caps as geometry rather than as markers. The canvas takes their colour from `context-stroke`,
    // which two markers can then serve every branch hue with, but that is a browser reading a live
    // document; a file opened in a drawing tool would get arrowheads with no colour at all.
    const caps = capsOf(stroke)
    if (caps) {
      out.push(emitCap(edge.startCap, caps.start, style.width, color))
      out.push(emitCap(edge.endCap, caps.end, style.width, color))
    }
  }

  if (edge.label) {
    const at = edgeShape(edge.routing ?? "curve", anchors).label
    out.push(emitPill(edge.label, at.x, at.y, LABEL, paint))
  }

  return out.join("")
}

/**
 * An arrowhead or a dot, at the end of a line and pointing the way it was going.
 *
 * The geometry is the marker's own, unrolled: the arrow marker is a triangle in an eight unit box
 * scaled by five stroke widths with its reference point at the tip, and the dot a circle of radius
 * 3.2 scaled by four. Written out here so a cap in an exported file is the same glyph, at the same
 * size, as the one the canvas draws.
 */
function emitCap(cap: ArrowCap | undefined, at: CapPlacement, width: number, color: string): string {
  if (cap === "arrow") {
    const s = (width * 5) / 8
    const points = [
      [-7 * s, -3.5 * s],
      [1 * s, 0],
      [-7 * s, 3.5 * s],
    ]
      .map(([x, y]) => {
        const cos = Math.cos(at.angle)
        const sin = Math.sin(at.angle)
        return `${n(at.x + x * cos - y * sin)},${n(at.y + x * sin + y * cos)}`
      })
      .join(" ")
    return `<polygon points="${points}" fill="${color}"/>`
  }

  if (cap === "dot") {
    return `<circle cx="${n(at.x)}" cy="${n(at.y)}" r="${n(width * 1.6)}" fill="${color}"/>`
  }

  return ""
}

/* -------------------------------------------------------------------------- */
/* Elements                                                                   */
/* -------------------------------------------------------------------------- */

function emitElement(element: SceneElement, paint: Paint): string {
  if (element.kind === "frame") {
    return emitFrame(element, paint)
  }

  const accent = accentOf(element)
  const out: string[] = [emitBox(element, accent, paint)]

  if (element.content.$type === "task") {
    out.push(emitCheckbox(element, accent, paint))
  }

  // A picture stands in for the body rather than sitting beside it, which is what the canvas does
  // too: the box was sized to the picture, so there is no room for both.
  const image = imageRefOf(element.content)
  out.push(image ? emitImage(element, image, paint) : emitBody(element, paint))

  if (element.refBadge) {
    const y = element.y + element.height / 2
    const right = element.x + element.width - 6
    out.push(emitPill(element.refBadge, right, y, badgeStyle(accent), paint, "end"))
  }

  const language = codeLanguage(element)
  if (language) {
    // Over the source rather than beside it, painting the body's own colour behind itself, so the
    // line it covers ends rather than runs under it.
    out.push(
      emitPill(
        language,
        element.x + element.width - element.padding.x,
        element.y + element.padding.y + 6.5,
        { ...CODE_CHIP, fill: surfaceOf(element) },
        paint,
        "end",
      ),
    )
  }

  if (element.hiddenCount > 0) {
    out.push(
      emitPill(
        String(element.hiddenCount),
        element.x + element.width + 4,
        element.y + element.height / 2,
        badgeStyle(accent, 10, 15),
        paint,
        "start",
      ),
    )
  }

  return out.filter(Boolean).join("")
}

/**
 * The chrome a node wears, which is the shape ladder made literal.
 *
 * A ring the canvas draws as an inset box shadow is a stroke half a pixel inside the box here, since
 * SVG centres a stroke on the path it is given and a rectangle stroked on its own edge would sit half
 * outside the box it belongs to.
 */
function emitBox(element: SceneElement, accent: string | undefined, paint: Paint): string {
  const { x, y, width, height } = element

  if (element.kind === "shape") {
    return emitShape(element, accent, paint)
  }
  // A caption is words on the canvas rather than a node on it. Giving it a card would make every
  // annotation look like something the map connects to. A picture is its own box, and a card behind
  // one is a rim nobody asked for around every photo.
  if (element.kind === "text" || element.kind === "image") {
    return ""
  }

  // A root is a bigger box and takes a bigger radius, which is the only thing about its corners that
  // is its own rather than the rung's.
  const radius = element.isRoot ? 14 : 10

  switch (element.nodeShape) {
    case "plain": {
      // A plain node has no box at all: its rule is its whole chrome, and the branch that arrives
      // lands on that rule rather than on an invisible bounding box.
      const weight = element.underline ?? 2
      const line = y + height - weight / 2
      return (
        `<line x1="${n(x)}" y1="${n(line)}" x2="${n(x + width)}" y2="${n(line)}"` +
        ` stroke="${paint.color(accent ?? "var(--line)")}" stroke-width="${n(weight)}"/>`
      )
    }
    case "pill":
      return rect(x, y, width, height, height / 2, {
        fill: fillOf(element, paint),
        ring: accent ? paint.color(mixColor(accent, 16)) : undefined,
      })
    case "outline":
      return rect(x, y, width, height, radius, { ring: paint.color(accent ?? "var(--line)") })
    default:
      // A root's card is the same rung read louder: it is the one box everything else on the map
      // hangs off, so it is lifted off the canvas as well as ringed against it.
      if (element.isRoot) {
        return rect(x, y, width, height, radius, {
          fill: fillOf(element, paint),
          ring: paint.color(mixColor(accent ?? "var(--line)", 32)),
          filter: "url(#mm-root-shadow)",
        })
      }
      return rect(x, y, width, height, radius, {
        fill: fillOf(element, paint),
        ring: paint.color(accent ? mixColor(accent, 32) : "var(--line-soft)"),
      })
  }
}

function emitShape(element: SceneElement, accent: string | undefined, paint: Paint): string {
  const shape = shapeOf(element)
  const open = isOpenShape(shape)
  const color = paint.color(accent ?? "var(--line)")
  const path =
    `<path d="${shapePath(shape, element.width, element.height)}"` +
    ` fill="${open ? "none" : paint.color(element.fill ?? "var(--canvas)")}"` +
    ` stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>`

  // The shaft runs bottom left to top right, so an arrow's head sits at the top right corner
  // pointing out along it, which is the one direction the shape itself already fixed.
  const head =
    shape === "arrow"
      ? emitCap(
          "arrow",
          { x: element.width, y: 0, angle: Math.atan2(-element.height, element.width) },
          1.5,
          color,
        )
      : ""

  return `<g transform="translate(${n(element.x)}, ${n(element.y)})">${path}${head}</g>`
}

/**
 * A frame: a dashed region around the things it holds.
 *
 * The dash is written out because a browser picks its own pattern for a one pixel dashed border and
 * a file cannot ask for "whatever the browser would have done".
 */
function emitFrame(element: SceneElement, paint: Paint): string {
  const hue = accentOf(element)
  const title = (element.content as FrameContent).title ?? ""
  const color = paint.color(hue ? mixColor(hue, 55) : "var(--line)")

  const border = rect(element.x, element.y, element.width, element.height, 16, {
    ring: color,
    dash: "4 3",
  })

  const label = paint.color(hue ?? "var(--ink-2)")
  const head = element.y + 9.5
  const text =
    emitText(title, element.x + 12, head, {
      family: FONT_FAMILY,
      size: 11,
      weight: 500,
      fill: label,
      letterSpacing: "0.01em",
    }) +
    emitText(String(element.childCount), element.x + 12 + paint.measure(title, 11, 500) + 6, head, {
      family: FONT_FAMILY,
      size: 11,
      weight: 500,
      fill: paint.color("var(--ink-3)"),
      letterSpacing: "0.01em",
    })

  return border + text
}

/** The box a task is ticked in, and the tick when it has been. */
function emitCheckbox(element: SceneElement, accent: string | undefined, paint: Paint): string {
  const color = paint.color(accent ?? "var(--line)")
  const x = element.x + 8
  const y = element.y + (element.height - 13) / 2
  const box = rect(x, y, 13, 13, 4, { ring: color, ringWidth: 1.5 })

  if (!isDone(element)) {
    return box
  }

  // The app's own check, at the size the node draws it: a twenty four unit glyph shown at nine.
  return (
    box +
    `<g transform="translate(${n(x + 2)}, ${n(y + 2)}) scale(0.375)">` +
    `<path d="M20 6 9 17 4 12" fill="none" stroke="${color}" stroke-width="2.5"` +
    ' stroke-linecap="round" stroke-linejoin="round"/></g>'
  )
}

/**
 * What a node draws in the space its box was measured around.
 *
 * The lines are the projector's, never re-wrapped: the box was measured against exactly this break
 * decision, and a second opinion about where a line ends is a label that no longer fits its box.
 */
function emitBody(element: SceneElement, paint: Paint): string {
  const { text } = element
  if (text.lines.length === 0) {
    return ""
  }

  const body = bodyOf(element.content)
  const done = isDone(element)
  const faded = done || element.refMissing === true
  const fill = paint.color(faded ? "var(--ink-3)" : (element.textColor ?? "var(--ink)"))
  const centred = element.isRoot || element.kind === "shape" || body === "math"

  // The rule a plain node draws sits inside its box, so the text is centred in what is left above it.
  const inner = element.nodeShape === "plain" ? element.height - (element.underline ?? 2) : element.height
  const top = element.y + (inner - text.lines.length * text.lineHeight) / 2

  const style: TextStyle = {
    family: body === "code" ? MONO_FAMILY : FONT_FAMILY,
    size: text.fontSize,
    weight: text.fontWeight,
    fill,
    letterSpacing: body === "code" ? undefined : text.letterSpacing,
    strike: done,
    italic: body === "math" || element.refMissing === true,
  }

  const anchor = centred ? "middle" : "start"
  const x = centred ? element.x + element.width / 2 : element.x + element.padding.x + leadInset(element)

  const lines = text.lines
    .map((line, index) => emitText(line, x, top + (index + 0.5) * text.lineHeight, style, anchor))
    .join("")

  // Source is not wrapped, so a line wider than the box has to be cut off at the edge the way the
  // canvas cuts it off, rather than running out across the map.
  if (body !== "code") {
    return lines
  }
  const clip = `mm-clip-${safeId(element.id)}`
  return (
    `<clipPath id="${clip}"><rect x="${n(element.x)}" y="${n(element.y)}" width="${n(element.width)}"` +
    ` height="${n(element.height)}"/></clipPath>` +
    `<g clip-path="url(#${clip})">${lines}</g>`
  )
}

/**
 * A picture, stretched to the box it was given.
 *
 * The bytes travel inside the file. An exported map is read without the app's token and often without
 * the app running, so a picture that was only an address would be a broken image everywhere except
 * here, and the raster path refuses anything but a data URI outright.
 *
 * One that could not be read leaves a dashed box behind rather than nothing. A picture missing from
 * an export should look like the gap it is, not like a place where the map happened to be empty.
 */
function emitImage(element: SceneElement, image: ImageRef, paint: Paint): string {
  const { x, y, width, height } = element
  const href = paint.image?.(image.assetId) ?? null
  if (!href) {
    return rect(x, y, width, height, 6, {
      fill: paint.color("var(--frame-hover)"),
      ring: paint.color("var(--line)"),
      dash: "4 3",
    })
  }

  // Clipped rather than rounded, since an image has no radius of its own, and stretched rather than
  // fitted so a box someone dragged out of proportion stays the shape they dragged it to.
  const clip = `mm-img-${safeId(element.id)}`
  return (
    `<clipPath id="${clip}"><rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}" rx="6"/></clipPath>` +
    `<image clip-path="url(#${clip})" x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}"` +
    ` preserveAspectRatio="none" href="${escape(href)}"/>` +
    rect(x, y, width, height, 6, { ring: paint.color("var(--line-soft)") })
  )
}

/* -------------------------------------------------------------------------- */
/* Primitives                                                                 */
/* -------------------------------------------------------------------------- */

interface RectStyle {
  readonly fill?: string
  readonly ring?: string
  readonly ringWidth?: number
  readonly dash?: string
  readonly filter?: string
}

function rect(x: number, y: number, width: number, height: number, radius: number, style: RectStyle): string {
  const w = style.ring ? (style.ringWidth ?? 1) : 0
  const inset = w / 2
  const rx = Math.max(0, Math.min(radius - inset, (width - w) / 2, (height - w) / 2))

  return (
    `<rect x="${n(x + inset)}" y="${n(y + inset)}" width="${n(Math.max(0, width - w))}"` +
    ` height="${n(Math.max(0, height - w))}" rx="${n(rx)}" fill="${style.fill ?? "none"}"` +
    (style.ring ? ` stroke="${style.ring}" stroke-width="${n(w)}"` : "") +
    (style.dash ? ` stroke-dasharray="${style.dash}"` : "") +
    (style.filter ? ` filter="${style.filter}"` : "") +
    "/>"
  )
}

interface TextStyle {
  readonly family: string
  readonly size: number
  readonly weight: number
  readonly fill: string
  readonly letterSpacing?: string
  readonly strike?: boolean
  readonly italic?: boolean
}

/**
 * One line, centred on the y it is given.
 *
 * On the central baseline rather than on the alphabetic one, so the caller can hand over the middle
 * of the line box it laid out instead of working out where a font's baseline sits inside it.
 */
function emitText(
  text: string,
  x: number,
  y: number,
  style: TextStyle,
  anchor: "start" | "middle" | "end" = "start",
): string {
  if (!text) {
    return ""
  }

  return (
    `<text x="${n(x)}" y="${n(y)}" font-family="${escape(style.family)}" font-size="${n(style.size)}"` +
    ` font-weight="${style.weight}" fill="${style.fill}" dominant-baseline="central"` +
    (anchor === "start" ? "" : ` text-anchor="${anchor}"`) +
    (style.letterSpacing && style.letterSpacing !== "normal"
      ? ` letter-spacing="${escape(style.letterSpacing)}"`
      : "") +
    (style.italic ? ' font-style="italic"' : "") +
    (style.strike ? ' text-decoration="line-through"' : "") +
    ' xml:space="preserve">' +
    escape(text) +
    "</text>"
  )
}

interface PillStyle {
  readonly size: number
  readonly height: number
  readonly padding: number
  readonly radius: number
  readonly weight: number
  readonly fill: string
  readonly text: string
  readonly ring?: string
  readonly mono?: boolean
}

/**
 * A chip: text in a rounded box sized around it.
 *
 * Sized here rather than by the projector because none of these are part of the box a node was
 * measured to, they are chrome that hangs off it, so nothing downstream depends on the width coming
 * out to a particular number.
 */
function emitPill(
  text: string,
  x: number,
  y: number,
  style: PillStyle,
  paint: Paint,
  anchor: "start" | "middle" | "end" = "middle",
): string {
  const measure = style.mono ? paint.measureMono : paint.measure
  const width = measure(text, style.size, style.weight) + style.padding * 2
  const left = anchor === "start" ? x : anchor === "end" ? x - width : x - width / 2
  const top = y - style.height / 2

  return (
    rect(left, top, width, style.height, style.radius, {
      fill: paint.color(style.fill),
      ring: style.ring ? paint.color(style.ring) : undefined,
    }) +
    emitText(
      text,
      left + width / 2,
      y,
      {
        family: style.mono ? MONO_FAMILY : FONT_FAMILY,
        size: style.size,
        weight: style.weight,
        fill: paint.color(style.text),
      },
      "middle",
    )
  )
}

const LABEL: PillStyle = {
  size: 10.5,
  height: 16,
  padding: 6,
  radius: 8,
  weight: 400,
  fill: "var(--canvas)",
  text: "var(--ink-2)",
  ring: "var(--line-soft)",
}

const CODE_CHIP: PillStyle = {
  size: 9.5,
  height: 13,
  padding: 4,
  radius: 3,
  weight: 400,
  fill: "var(--canvas)",
  text: "var(--ink-3)",
  mono: true,
}

function badgeStyle(accent: string | undefined, size = 9.5, height = 14): PillStyle {
  return {
    size,
    height,
    padding: 6,
    radius: height / 2,
    weight: 500,
    fill: accent ?? "var(--ink-3)",
    text: "var(--canvas)",
  }
}

/* -------------------------------------------------------------------------- */
/* Element facts                                                              */
/* -------------------------------------------------------------------------- */

/**
 * How far the label starts in from the padding, which is the room the glyph and the checkbox take.
 *
 * Read off what the canvas lays out rather than off what the measurement reserved, because those two
 * differ for an icon: a style can put one on any node without the box being widened for it, and the
 * text still moves over to make room.
 */
function leadInset(element: SceneElement): number {
  const refGlyph = refGlyphOf(element.content)
  let lead = refGlyph ? 20 : element.icon ? 21 : 0
  if (element.content.$type === "task") {
    lead += 21
  }
  return lead
}

/** What a body is painted, or nothing at all when it was never given a colour of its own. */
function fillOf(element: SceneElement, paint: Paint): string {
  const wash = washOf(accentOf(element))
  if (element.nodeShape === "pill" && wash) {
    return paint.color(wash)
  }
  return element.fill ? paint.color(element.fill) : "none"
}

/** The colour the body was painted, which is also what a chip sitting on top of it paints behind. */
function surfaceOf(element: SceneElement): string {
  const wash = washOf(accentOf(element))
  if (element.nodeShape === "pill" && wash) {
    return wash
  }
  return element.fill ?? "var(--canvas)"
}

function isDone(element: SceneElement): boolean {
  return element.content.$type === "task" && (element.content as { done?: boolean }).done === true
}

function codeLanguage(element: SceneElement): string | null {
  if (element.content.$type !== "code") {
    return null
  }
  return (element.content as CodeContent).language?.trim() || null
}

function shapeOf(element: SceneElement): ShapeType {
  return (element.content as ShapeContent).shape ?? "rectangle"
}

/* -------------------------------------------------------------------------- */
/* Text                                                                       */
/* -------------------------------------------------------------------------- */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ESCAPES[character])
}

/** An id an XML document will accept, since a scene's ids are only ever a map's own business. */
function safeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "_")
}

function n(value: number): number {
  return Math.round(value * 100) / 100
}
