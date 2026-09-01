/**
 * The crop math, shared by the editor's stage and by every surface that draws a stored crop.
 *
 * Two rules carry the rest of it. Zoom is measured against cover fit rather than against the
 * source, so 1 always means exactly filling the frame, which is what lets pan and zoom survive
 * a change of frame shape untouched. Pan is a fraction of the available overhang, so clamping
 * is a plain 0 to 1 and no representable state shows empty ground inside the frame.
 *
 * Nothing here touches pixels. A crop is five numbers over an untouched source, so reopening an
 * edit a week later still crops the original instead of cropping a crop.
 */

/** Which part of the source is showing, in fractions of the natural size rather than in pixels. */
export interface ImageCrop {
  /** Top left of the window. */
  x: number
  y: number
  /** Its size. */
  w: number
  h: number
  /**
   * The frame's width over its height. Derivable from the natural size, carried anyway so a
   * consumer can reserve the right box before the file has decoded.
   */
  aspect: number
}

/** Frame size and source shape, which is everything the geometry reads. */
export interface Frame {
  fw: number
  fh: number
  /** The source's natural width over its natural height. */
  ratio: number
}

/** Where the source sits under the frame. */
export interface View {
  /** 1 is cover fit, not 100 percent of the source. */
  zoom: number
  /** Fractions of the overhang, 0.5 being centred. */
  ox: number
  oy: number
}

export interface Size {
  width: number
  height: number
}

/** An image's box inside a container, in container pixels. */
export interface CropLayout {
  width: number
  height: number
  left: number
  top: number
}

export const FIT: View = { zoom: 1, ox: 0.5, oy: 0.5 }

/**
 * Enough to lift a figure out of a screenshot, not enough to blow a thumbnail up into porridge.
 * Past this the honest answer is a better source.
 */
export const ZOOM_MAX = 4

/** Keeps a degenerate crop from dividing by zero; smaller than any window anyone can drag. */
export const MIN_FRACTION = 1e-6

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * The scaled source, in frame pixels.
 *
 * Whichever edge would leave a gap is the one that binds, which is the whole of cover fit.
 * Doing it here rather than in CSS is what lets the same numbers drive the drag, the clamp and
 * the crop that comes out.
 */
export function scaled({ fw, fh, ratio }: Frame, zoom: number): { sw: number; sh: number } {
  const frameAspect = fw / fh
  const base = ratio > frameAspect ? { w: fh * ratio, h: fh } : { w: fw, h: fw / ratio }
  return { sw: base.w * zoom, sh: base.h * zoom }
}

/**
 * A drag, in pixels, applied to the fractional pan.
 *
 * An axis with no overhang would divide by zero, so it pins to centre instead, which is also
 * the only correct answer for it.
 */
export function panBy(view: View, dx: number, dy: number, frame: Frame): View {
  const { sw, sh } = scaled(frame, view.zoom)
  const overhangX = sw - frame.fw
  const overhangY = sh - frame.fh
  return {
    ...view,
    ox: overhangX > 0.5 ? clamp(view.ox - dx / overhangX, 0, 1) : 0.5,
    oy: overhangY > 0.5 ? clamp(view.oy - dy / overhangY, 0, 1) : 0.5,
  }
}

/**
 * Zoom that holds one point still.
 *
 * `cx` and `cy` are pixels from the frame's top left. Find the source point under there now,
 * then solve for the pan that keeps it under there afterwards. The slider and the keyboard have
 * no cursor, so they pass the frame centre and reuse this rather than growing a second path
 * that disagrees about where the picture went.
 */
export function zoomAt(view: View, next: number, cx: number, cy: number, frame: Frame): View {
  const before = scaled(frame, view.zoom)
  const ux = (view.ox * (before.sw - frame.fw) + cx) / before.sw
  const uy = (view.oy * (before.sh - frame.fh) + cy) / before.sh

  const zoom = clamp(next, 1, ZOOM_MAX)
  const after = scaled(frame, zoom)
  const overhangX = after.sw - frame.fw
  const overhangY = after.sh - frame.fh

  return {
    zoom,
    ox: overhangX > 0.5 ? clamp((ux * after.sw - cx) / overhangX, 0, 1) : 0.5,
    oy: overhangY > 0.5 ? clamp((uy * after.sh - cy) / overhangY, 0, 1) : 0.5,
  }
}

/** The view, as the value a caller stores. */
export function toCrop(view: View, frame: Frame): ImageCrop {
  const { sw, sh } = scaled(frame, view.zoom)
  const w = clamp(frame.fw / sw, 0, 1)
  const h = clamp(frame.fh / sh, 0, 1)
  return {
    x: view.ox * (1 - w),
    y: view.oy * (1 - h),
    w,
    h,
    aspect: frame.fw / frame.fh,
  }
}

/**
 * And back again, for reopening.
 *
 * No frame needed: at zoom 1 the window covers exactly, so one of `w` and `h` is necessarily 1
 * and the larger of the two is the reciprocal of the zoom. A stored crop therefore restores the
 * exact frame someone left before the dialog has measured anything.
 */
export function fromCrop(crop: ImageCrop): View {
  return {
    zoom: clamp(1 / Math.max(crop.w, crop.h), 1, ZOOM_MAX),
    ox: crop.w < 1 ? clamp(crop.x / (1 - crop.w), 0, 1) : 0.5,
    oy: crop.h < 1 ? clamp(crop.y / (1 - crop.h), 0, 1) : 0.5,
  }
}

/** The whole picture, uncropped, for a source that has just arrived. */
export function wholeCrop(ratio: number): ImageCrop {
  return { x: 0, y: 0, w: 1, h: 1, aspect: ratio }
}

/**
 * Whether a crop keeps the entire source, so a caller can store null instead of a no-op crop.
 *
 * Exact equality is safe here: `toCrop(FIT, frame)` for a frame whose shape matches the source
 * produces `{ x: 0, y: 0, w: 1, h: 1 }` bit for bit, with no rounding anywhere on that path.
 */
export function isWholeCrop(crop: ImageCrop): boolean {
  return crop.w === 1 && crop.h === 1
}

/**
 * A stored crop placed in a container whose shape it was not cut for.
 *
 * The cover band is the case: its height is fixed and its width follows the pane, so the crop
 * window has to cover a box that changes aspect under it. The window is scaled to cover and
 * anchored on its own centre, so widening the pane reveals more of the sides rather than sliding
 * the subject out of view.
 *
 * The window's shape is taken from the natural size rather than from `crop.aspect`, because the
 * source is scaled uniformly here. `crop.aspect` describes the frame the crop was cut for, and
 * using it would stretch the picture whenever the two disagree.
 */
export function fitCropToContainer(crop: ImageCrop, container: Size, natural: Size): CropLayout {
  const cw = Math.max(0, container.width)
  const ch = Math.max(0, container.height)
  if (cw === 0 || ch === 0) return { width: 0, height: 0, left: 0, top: 0 }

  const w = clamp(crop.w, MIN_FRACTION, 1)
  const h = clamp(crop.h, MIN_FRACTION, 1)

  let windowAspect = crop.aspect
  if (natural.width > 0 && natural.height > 0) windowAspect = (w * natural.width) / (h * natural.height)
  if (!(windowAspect > 0)) windowAspect = cw / ch

  const wider = windowAspect > cw / ch
  const windowW = wider ? ch * windowAspect : cw
  const windowH = wider ? ch : cw / windowAspect

  const width = windowW / w
  const height = windowH / h
  return {
    width,
    height,
    left: (cw - windowW) / 2 - crop.x * width,
    top: (ch - windowH) / 2 - crop.y * height,
  }
}
