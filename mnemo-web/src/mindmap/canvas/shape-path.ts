/**
 * The outlines of the free shapes.
 *
 * The prototype cut all of these deliberately. Its node vocabulary is three rungs of loudness, plain,
 * pill and box, on the argument that nobody can say what a hexagon means in a mindmap, so every map
 * ends up using rectangles anyway. That argument still holds for text nodes, and nothing in this file
 * is reachable from a node's style. What is here is for `kind: "shape"` elements, whose whole point is
 * to be a drawn figure rather than a labelled idea, and whose vocabulary Core fixes at eight
 * members. The dock's Shape tool has to be able to draw all eight, so all eight live here.
 *
 * Everything is pure geometry in a box whose origin is 0,0. The caller positions the element with a
 * transform, which means a shape that moves does not re-derive its path, and two elements of the same
 * size share the same string. Sizes arrive from the same measurement pipeline the nodes use, so a
 * path has to survive any width and height without ever putting a coordinate outside its own box: a
 * shape that overhangs its bounds is a shape whose selection outline and whose hit test both lie.
 *
 * Where a proportion had to be chosen it is a fraction of the box rather than a number of pixels, so
 * that everything except the rectangle's corner radius is exactly proportional to its box. A shape
 * that changes its own proportions as it is resized reads as a different shape halfway through the
 * drag, and the corner radius is the one exception because it is matching a CSS radius, which is
 * absolute too.
 */

import type { ShapeType } from "../model/document"

/**
 * Matches the radius a card node draws, so a rectangle sitting next to one reads as the same family
 * of box rather than as a foreign object that wandered in from a flowchart.
 */
const CORNER = 10

/**
 * The hexagon's bevel, and the parallelogram's lean, as fractions of the box.
 *
 * Both are taken off the HEIGHT and only capped by the width. The usual convention is the other way
 * round, a percentage of the width the way a CSS `clip-path: polygon(25% 0%, ...)` writes it, but the
 * boxes in this app are a short label's worth of text: wide and not tall. A width fraction flattens
 * into a rectangle with clipped corners as soon as the label gets long, and the same shape drawn
 * around one word and around six would not look like the same shape. Off the height, the bevel keeps
 * its size whatever the label does. The caps stop a narrow box from folding through itself.
 */
const SHOULDER_OF_HEIGHT = 0.5
const SHOULDER_CAP_OF_WIDTH = 0.25
const SLANT_OF_HEIGHT = 0.35
const SLANT_CAP_OF_WIDTH = 1 / 3

/**
 * The blob's four anchors, as fractions of the box.
 *
 * They sit on the edges rather than at the corners, so the shape touches every side and fills its
 * box the way an ellipse does. Nudging each one off the midpoint is the whole of what makes it a
 * blob: centre all four and give every quarter the same roundness and this is an ellipse.
 */
const BLOB_TOP = 0.38
const BLOB_RIGHT = 0.34
const BLOB_BOTTOM = 0.62
const BLOB_LEFT = 0.66

/**
 * How far each quarter swells towards the corner it passes, going clockwise from the top anchor.
 *
 * Around the 0.552 that draws a true quarter circle, above it to bulge into the corner and below it
 * to pull away. Varying them is the second half of the asymmetry, and keeping them under one is what
 * guarantees the curve stays in its box: every control point below lands on a box edge, and a cubic
 * never leaves the convex hull of its four points.
 */
const BLOB_ROUNDNESS = [0.86, 0.54, 0.9, 0.62]

/**
 * Reached only if Core grows a ninth `ShapeType`, which makes this fail to compile rather than
 * silently drawing the new shape as nothing.
 */
function unhandled(shape: never): never {
  throw new Error(`unhandled shape: ${String(shape)}`)
}

/**
 * A coordinate as path data.
 *
 * Three decimals is far below a device pixel at any zoom this canvas reaches, and it keeps the `d`
 * attribute readable in an inspector instead of seventeen digits of float residue per number, on
 * every shape in the document.
 */
function n(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}

function shoulder(w: number, h: number): number {
  return Math.min(h * SHOULDER_OF_HEIGHT, w * SHOULDER_CAP_OF_WIDTH)
}

function slant(w: number, h: number): number {
  return Math.min(h * SLANT_OF_HEIGHT, w * SLANT_CAP_OF_WIDTH)
}

function rectanglePath(w: number, h: number): string {
  // Clamped so a box smaller than two radii keeps a rectangle's silhouette instead of turning into a
  // stadium with its arcs crossing over.
  const r = Math.min(CORNER, w / 2, h / 2)
  return (
    `M${n(r)},0 L${n(w - r)},0 A${n(r)},${n(r)} 0 0 1 ${n(w)},${n(r)} ` +
    `L${n(w)},${n(h - r)} A${n(r)},${n(r)} 0 0 1 ${n(w - r)},${n(h)} ` +
    `L${n(r)},${n(h)} A${n(r)},${n(r)} 0 0 1 0,${n(h - r)} ` +
    `L0,${n(r)} A${n(r)},${n(r)} 0 0 1 ${n(r)},0 Z`
  )
}

/**
 * Two half arcs rather than one `<ellipse>`, because every shape here has to be sayable as one `d`
 * string: the layer that draws them picks fill and stroke per element and should not also have to
 * pick an element name.
 */
function ellipsePath(w: number, h: number): string {
  const rx = w / 2
  const ry = h / 2
  return `M0,${n(ry)} A${n(rx)},${n(ry)} 0 1 1 ${n(w)},${n(ry)} A${n(rx)},${n(ry)} 0 1 1 0,${n(ry)} Z`
}

function diamondPath(w: number, h: number): string {
  return `M${n(w / 2)},0 L${n(w)},${n(h / 2)} L${n(w / 2)},${n(h)} L0,${n(h / 2)} Z`
}

function hexagonPath(w: number, h: number): string {
  const s = shoulder(w, h)
  return (
    `M${n(s)},0 L${n(w - s)},0 L${n(w)},${n(h / 2)} ` +
    `L${n(w - s)},${n(h)} L${n(s)},${n(h)} L0,${n(h / 2)} Z`
  )
}

function parallelogramPath(w: number, h: number): string {
  const k = slant(w, h)
  return `M${n(k)},0 L${n(w)},0 L${n(w - k)},${n(h)} L0,${n(h)} Z`
}

/**
 * A hand-drawn looking closed curve: four cubics between four anchors on the four edges.
 *
 * The one shape here that is not a figure from a flowchart, and the reason it is worth having. A
 * hexagon says "this is a step in a process" whether or not that is true; a blob says only "this is
 * a region", which is what someone circling three related ideas actually means.
 *
 * The same curve every time rather than a sampled wobble, because a shape that is drawn from noise
 * is a shape that changes silhouette on every render, and two blobs on one map should read as the
 * same kind of thing.
 */
function blobPath(w: number, h: number): string {
  const [tr, rb, bl, lt] = BLOB_ROUNDNESS
  const tx = w * BLOB_TOP
  const ry = h * BLOB_RIGHT
  const bx = w * BLOB_BOTTOM
  const ly = h * BLOB_LEFT

  return (
    `M${n(tx)},0 ` +
    `C${n(tx + tr * (w - tx))},0 ${n(w)},${n(ry * (1 - tr))} ${n(w)},${n(ry)} ` +
    `C${n(w)},${n(ry + rb * (h - ry))} ${n(bx + rb * (w - bx))},${n(h)} ${n(bx)},${n(h)} ` +
    `C${n(bx * (1 - bl))},${n(h)} 0,${n(ly + bl * (h - ly))} 0,${n(ly)} ` +
    `C0,${n(ly * (1 - lt))} ${n(tx * (1 - lt))},0 ${n(tx)},0 Z`
  )
}

/**
 * The shaft shared by the line and the arrow, corner to corner across the box.
 *
 * Bottom left to top right so that dragging a corner handle moves the end of the stroke that the
 * handle is nearest, which is the only behaviour anyone expects from resizing a line. The arrow adds
 * nothing to the geometry: its head is the same marker the edge layer already defines for an arrow
 * cap, so a shape arrow and an edge's arrow are the same glyph rather than two drawings of one idea.
 */
function diagonalPath(w: number, h: number): string {
  return `M0,${n(h)} L${n(w)},0`
}

/** The outline of a shape drawn in a box of this size with its origin at 0,0. */
export function shapePath(shape: ShapeType, width: number, height: number): string {
  // A box can be dragged to nothing mid gesture, and a negative size would put every coordinate
  // outside the box rather than producing a small shape.
  const w = Math.max(0, width)
  const h = Math.max(0, height)

  switch (shape) {
    case "rectangle":
      return rectanglePath(w, h)
    case "ellipse":
      return ellipsePath(w, h)
    case "diamond":
      return diamondPath(w, h)
    case "hexagon":
      return hexagonPath(w, h)
    case "parallelogram":
      return parallelogramPath(w, h)
    case "blob":
      return blobPath(w, h)
    case "line":
    case "arrow":
      return diagonalPath(w, h)
  }

  return unhandled(shape)
}

/**
 * The gap on each side between the box and the largest centred rectangle that fits inside the
 * outline while keeping the box's own proportions.
 *
 * Keeping the proportions is what makes one number answer for both axes. A node box is measured
 * around its text, so the text block and the box already have roughly the same aspect ratio, and
 * asking for the largest similar rectangle asks the question the caller actually has: how much
 * smaller does the text have to get before the outline stops cutting through it.
 */
function similarFit(fraction: number, w: number, h: number): { x: number; y: number } {
  const gap = (1 - fraction) / 2
  return { x: w * gap, y: h * gap }
}

const NO_INSET = { x: 0, y: 0 }

/** How far inline text sits inside the outline, per side. A diamond needs far more than a card. */
export function shapeTextInset(
  shape: ShapeType,
  width: number,
  height: number,
): { x: number; y: number } {
  const w = Math.max(0, width)
  const h = Math.max(0, height)
  // Every fraction below divides by a box dimension, and an empty box has no interior to inset into.
  if (w <= 0 || h <= 0) {
    return { ...NO_INSET }
  }

  switch (shape) {
    case "rectangle":
      // The outline is the box, so the caller's own padding is the whole of the answer.
      return { ...NO_INSET }
    case "ellipse":
      // A square inscribed in a circle has side r*sqrt(2), and the same ratio survives the stretch
      // into an ellipse because the stretch is affine.
      return similarFit(Math.SQRT1_2, w, h)
    case "diamond":
      // The boundary is |x| + |y| = 1 once normalised, so the two half widths have to sum to one and
      // a similar rectangle can only be half the box. Only the middle quarter of a diamond's area is
      // usable, which is why a diamond has to be sized well clear of its text rather than hugging it.
      return similarFit(0.5, w, h)
    case "hexagon": {
      // The binding constraint is the top edge of the text, where the bevel has eaten the most width.
      const s = shoulder(w, h)
      return similarFit(w / (w + 2 * s), w, h)
    }
    case "parallelogram": {
      // A parallelogram is the same width at every height, but it slides sideways as it goes, so an
      // axis aligned rectangle has to clear the top of one edge and the bottom of the other at once.
      const k = slant(w, h)
      return similarFit((w - k) / (w + k), w, h)
    }
    case "blob":
      // No closed form worth deriving from four cubics, so it is the ellipse's inscribed square
      // pulled in far enough to clear the quarters that bulge least. Erring tight costs a little
      // width; erring loose puts the outline through the text.
      return similarFit(0.62, w, h)
    case "line":
    case "arrow":
      // No interior to inset into. A caption on one of these sits alongside the stroke the way an
      // edge label does, which is the caller's business rather than this function's.
      return { ...NO_INSET }
  }

  return unhandled(shape)
}

/** True for the shapes that are a line rather than a region: nothing sits inside them. */
export function isOpenShape(shape: ShapeType): boolean {
  switch (shape) {
    case "line":
    case "arrow":
      return true
    case "rectangle":
    case "ellipse":
    case "diamond":
    case "hexagon":
    case "parallelogram":
    case "blob":
      return false
  }

  return unhandled(shape)
}
