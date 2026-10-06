/** The masks document in an occlusion fact's Masks field. Mirrors Mnemo.Core's FlashcardOcclusion, pinned by a shared fixture. */

export type OcclusionShape = "rect" | "ellipse" | "polygon"
export type OcclusionMode = "hideAll" | "hideOne"

/** One covered region of an image. Coordinates are fractions of the image, 0 to 1. */
export interface OcclusionMask {
  /** Never reused within a fact. The card key of an ungrouped mask is built from it. */
  id: string
  shape: OcclusionShape
  x: number
  y: number
  w: number
  h: number
  /** Polygon vertices as x, y pairs. */
  points?: [number, number][]
  label?: string
  /**
   * An opaque label shared by the masks asked as one card. Set once, when masks are grouped, and
   * never compared with live mask ids, so deleting or reordering members cannot change the key.
   */
  group?: string
  order: number
}

export interface OcclusionDocument {
  mode: OcclusionMode
  masks: OcclusionMask[]
}

/** The masks of one card: an ungrouped mask, or every mask sharing a group label. */
export interface OcclusionUnit {
  key: string
  members: OcclusionMask[]
}

export interface OcclusionUnitSet {
  /** The cards the document makes, in the order they are shown. */
  units: OcclusionUnit[]
  /** Keys a later unit claimed after an earlier one already held them. */
  collisions: string[]
}

/** The only schema version this build reads or writes. */
export const OCCLUSION_VERSION = 1
/** Masks beyond this many in a document are ignored on read. */
export const OCCLUSION_MAX_MASKS = 300
/** Polygon vertices beyond this many are ignored on read. */
export const OCCLUSION_MAX_POINTS = 100
/** Longest Masks field value a save accepts, in characters. */
export const OCCLUSION_MAX_FIELD_LENGTH = 200_000

/** Frozen ids of the fields on the built-in image occlusion type. */
export const OCCLUSION_TYPE_ID = "occlusion"
export const OCCLUSION_IMAGE_FIELD = "image"
export const OCCLUSION_FRONT_FIELD = "front"
export const OCCLUSION_BACK_FIELD = "back"
export const OCCLUSION_MASKS_FIELD = "masks"

/** Whether a Masks field value is longer than the server accepts, so a save would be refused. */
export function occlusionFieldTooLong(value: string | null | undefined): boolean {
  return (value?.length ?? 0) > OCCLUSION_MAX_FIELD_LENGTH
}

const ID_PATTERN = /^[a-z0-9]{1,16}$/
const CONTROL_CHARS = /\p{Cc}/gu
const SCALE = 10_000

/** Whether a string can be a mask id or a group label, which become part of a card key. */
export function isValidOcclusionId(value: string | null | undefined): value is string {
  return typeof value === "string" && ID_PATTERN.test(value)
}

/** Rounds to four decimals, the precision a stored coordinate keeps. */
export function roundCoordinate(value: number): number {
  return Math.round(value * SCALE) / SCALE
}

function clamp(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(item: Record<string, unknown>, name: string): string | null {
  const value = item[name]
  return typeof value === "string" ? value : null
}

function finite(item: Record<string, unknown>, name: string): number | null {
  const value = item[name]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function readPoints(item: Record<string, unknown>): [number, number][] | null {
  const raw = item.points
  if (!Array.isArray(raw)) return null

  const points: [number, number][] = []
  for (const pair of raw) {
    if (points.length >= OCCLUSION_MAX_POINTS) break
    if (!Array.isArray(pair) || pair.length !== 2) return null

    const [a, b] = pair as unknown[]
    if (typeof a !== "number" || typeof b !== "number" || !Number.isFinite(a) || !Number.isFinite(b)) return null
    points.push([roundCoordinate(clamp(a)), roundCoordinate(clamp(b))])
  }

  return points.length >= 3 ? points : null
}

function readMask(item: unknown, index: number): OcclusionMask | null {
  if (!isRecord(item)) return null

  const id = text(item, "id")
  if (!isValidOcclusionId(id)) return null

  const shape = text(item, "shape")
  if (shape !== "rect" && shape !== "ellipse" && shape !== "polygon") return null

  const rawLabel = text(item, "label")
  const label = rawLabel === null ? "" : rawLabel.replace(CONTROL_CHARS, " ").trim()
  const group = text(item, "group")
  const rawOrder = item.order
  const order =
    typeof rawOrder === "number" && Number.isFinite(rawOrder) && Math.abs(rawOrder) < 2_147_483_647
      ? Math.trunc(rawOrder)
      : index

  let x: number
  let y: number
  let w: number
  let h: number
  let points: [number, number][] | undefined
  if (shape === "polygon") {
    const read = readPoints(item)
    if (read === null) return null
    points = read
    x = Math.min(...read.map((p) => p[0]))
    y = Math.min(...read.map((p) => p[1]))
    w = Math.max(...read.map((p) => p[0])) - x
    h = Math.max(...read.map((p) => p[1])) - y
  } else {
    const rx = finite(item, "x")
    const ry = finite(item, "y")
    const rw = finite(item, "w")
    const rh = finite(item, "h")
    if (rx === null || ry === null || rw === null || rh === null) return null

    x = clamp(rx)
    y = clamp(ry)
    w = Math.min(clamp(rw), 1 - x)
    h = Math.min(clamp(rh), 1 - y)
  }

  x = roundCoordinate(x)
  y = roundCoordinate(y)
  w = roundCoordinate(w)
  h = roundCoordinate(h)
  if (w <= 0 || h <= 0) return null

  const mask: OcclusionMask = { id, shape, x, y, w, h, order }
  if (points) mask.points = points
  if (label) mask.label = label
  if (isValidOcclusionId(group)) mask.group = group
  return mask
}

/** Reads a Masks field value. Anything unreadable gives fewer masks, never an exception. */
export function parseOcclusion(json: string | null | undefined): OcclusionDocument {
  if (!json || json.trim().length === 0) return { mode: "hideAll", masks: [] }

  let root: unknown
  try {
    root = JSON.parse(json)
  } catch {
    return { mode: "hideAll", masks: [] }
  }

  if (!isRecord(root)) return { mode: "hideAll", masks: [] }
  if ("v" in root && root.v !== OCCLUSION_VERSION) return { mode: "hideAll", masks: [] }

  const mode: OcclusionMode = root.mode === "hideOne" ? "hideOne" : "hideAll"
  const masks: OcclusionMask[] = []
  if (Array.isArray(root.masks)) {
    const seen = new Set<string>()
    let index = 0
    for (const item of root.masks) {
      if (masks.length >= OCCLUSION_MAX_MASKS) break
      const mask = readMask(item, index++)
      if (mask && !seen.has(mask.id)) {
        seen.add(mask.id)
        masks.push(mask)
      }
    }
  }

  return { mode, masks }
}

/** Writes a document in the canonical form {@link parseOcclusion} reads back unchanged. */
export function serializeOcclusion(document: OcclusionDocument): string {
  return JSON.stringify({
    v: OCCLUSION_VERSION,
    mode: document.mode === "hideOne" ? "hideOne" : "hideAll",
    masks: document.masks.map((mask) => ({
      id: mask.id,
      shape: mask.shape,
      x: roundCoordinate(mask.x),
      y: roundCoordinate(mask.y),
      w: roundCoordinate(mask.w),
      h: roundCoordinate(mask.h),
      ...(mask.points && mask.points.length > 0
        ? { points: mask.points.map(([px, py]) => [roundCoordinate(px), roundCoordinate(py)]) }
        : {}),
      ...(mask.label ? { label: mask.label } : {}),
      ...(mask.group ? { group: mask.group } : {}),
      order: mask.order,
    })),
  })
}

/** The key a card made from a mask id or a group label is stored under. */
export function occlusionKey(idOrGroup: string): string {
  return `m${idOrGroup}`
}

function compareOrdinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * The cards a document makes: masks ordered by `order` then id, a group as one unit at its first
 * member. A later unit with a duplicate key is dropped and reported, so keys stay distinct.
 */
export function buildOcclusionUnits(document: OcclusionDocument): OcclusionUnitSet {
  const ordered = [...document.masks].sort((a, b) => a.order - b.order || compareOrdinal(a.id, b.id))

  const byName = new Map<string, OcclusionMask[]>()
  for (const mask of ordered) {
    const name = mask.group ? `g:${mask.group}` : `i:${mask.id}`
    const members = byName.get(name)
    if (members) members.push(mask)
    else byName.set(name, [mask])
  }

  const units: OcclusionUnit[] = []
  const collisions: string[] = []
  const keys = new Set<string>()
  for (const members of byName.values()) {
    const key = occlusionKey(members[0].group ? members[0].group : members[0].id)
    if (keys.has(key)) {
      collisions.push(key)
      continue
    }

    keys.add(key)
    units.push({ key, members })
  }

  return { units, collisions }
}

/** The answer text of a unit: its labels in member order, blanks skipped, joined by commas. */
export function occlusionLabelOf(unit: OcclusionUnit): string {
  return unit.members
    .map((mask) => mask.label?.trim() ?? "")
    .filter((label) => label.length > 0)
    .join(", ")
}
