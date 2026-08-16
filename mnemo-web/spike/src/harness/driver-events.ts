/**
 * Synthetic input event construction, dispatch and hit-targeting. Isolated
 * from gesture sequencing and proof logic so the DOM-specific plumbing
 * (pointer capture retargeting, the beforeinput/native-insertion fallback)
 * can be reasoned about and tested on its own, apart from timing.
 *
 * Every dispatch here targets a concrete node, never `window` or `document`.
 * Dispatching at window collapses capture-versus-bubble ordering into
 * whatever order listeners happen to be registered in, since window has no
 * ancestors for a capture phase to run through and no descendants for a
 * bubble to pass on the way up; a real gesture always starts on a real node
 * and bubbles from there, and that is what a handler filtering on
 * pointerId/buttons/isPrimary needs to see.
 */

/**
 * The window an event dispatched at `node` should carry as its `view`.
 *
 * This is not decoration. d3-zoom and d3-drag, which React Flow's pan and node drag are built
 * on, continue a gesture by doing `select(event.view).on("mousemove", ...)` and
 * `dragDisable(event.view)`. An event constructed without a view has `view === null`, so those
 * listeners register on an empty selection and dragDisable throws on `null.document`. The press
 * looks delivered and the gesture then does nothing at all, which reads as a renderer that
 * ignores input rather than as a malformed event.
 *
 * Taken from the node's own document rather than the ambient global: that is what a real user
 * agent does, it stays correct inside an iframe, and it is the object a DOM implementation's
 * own brand check will accept.
 */
let viewInitAccepted: boolean | undefined

/**
 * Whether this DOM implementation will accept a `view` in an event init at all.
 *
 * jsdom rejects every window object offered to it here, including its own `defaultView`, so a
 * harness that always set `view` could not be unit tested, and one that never set it would be
 * silently inert in the only environment whose numbers count. Probing once and remembering the
 * answer keeps the real browser correct without making the tests lie about what it does.
 */
function acceptsViewInit(view: Window): boolean {
  if (viewInitAccepted === undefined) {
    try {
      void new MouseEvent('mousedown', { view })
      viewInitAccepted = true
    } catch {
      viewInitAccepted = false
    }
  }
  return viewInitAccepted
}

function viewFor(node: HTMLElement): Window | undefined {
  const view = node.ownerDocument?.defaultView
  if (!view) return undefined
  return acceptsViewInit(view) ? view : undefined
}

let pointerIdSeed = 1000

/**
 * A fresh pointerId for one gesture. Real pointer ids are UA-assigned and
 * opaque; this only needs to stay stable across one gesture's down/move/up
 * and not collide with a concurrently-tracked one.
 */
export function nextPointerId(): number {
  pointerIdSeed += 1
  return pointerIdSeed
}

export interface PointerDispatchState {
  readonly pointerId: number
  readonly pointerType: string
  /**
   * Whether to follow each pointer event with its mouse-compatibility twin, as a real user
   * agent does. Not optional: an arm bound through `onMouseDown` (d3-drag and d3-zoom, which
   * React Flow's pan and node drag are built on, listen for mouse events rather than pointer
   * events) receives nothing at all from a pointer-only driver, and that shows up as a
   * mysterious no-op gesture rather than as anything nameable.
   */
  readonly mouseCompat: boolean
}

export type PointerGestureType = 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel'

const MOUSE_COMPAT_TYPE: Partial<Record<PointerGestureType, 'mousedown' | 'mousemove' | 'mouseup'>> = {
  pointerdown: 'mousedown',
  pointermove: 'mousemove',
  pointerup: 'mouseup',
  // pointercancel has no compat twin: a cancelled gesture is precisely the case where a UA
  // suppresses the mouse events rather than completing the sequence.
}

/**
 * Fires one mouse event at `node`. `click` is deliberately never synthesized: a real UA
 * fires it after a press and release on the same element, but every gesture here is a drag,
 * and a spurious click would toggle selection or open an editor in the middle of a
 * measured window.
 */
export function fireMouseEvent(
  node: HTMLElement,
  type: 'mousedown' | 'mousemove' | 'mouseup',
  point: { readonly x: number; readonly y: number },
): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: viewFor(node),
    buttons: type === 'mouseup' ? 0 : 1,
    button: 0,
    detail: type === 'mousemove' ? 0 : 1,
    clientX: point.x,
    clientY: point.y,
    screenX: point.x,
    screenY: point.y,
  })
  node.dispatchEvent(event)
  return event
}

/**
 * Fires one pointer event at `node`, followed by its mouse-compatibility twin unless the
 * pointer event was prevented (which is how a UA suppresses the compat event too). Always
 * dispatched at the same node the gesture started on: after a real pointerdown a UA
 * retargets captured pointer events to that node regardless of where the cursor now is, and
 * an author-dispatched event gets no such retargeting for free, so the driver has to target
 * it itself on every subsequent move and the final up.
 */
export function firePointerEvent(
  node: HTMLElement,
  type: PointerGestureType,
  point: { readonly x: number; readonly y: number },
  state: PointerDispatchState,
): PointerEvent {
  const pressed = type === 'pointerdown' || type === 'pointermove'
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: viewFor(node),
    pointerId: state.pointerId,
    pointerType: state.pointerType,
    isPrimary: true,
    buttons: pressed ? 1 : 0,
    button: type === 'pointerdown' || type === 'pointerup' ? 0 : -1,
    clientX: point.x,
    clientY: point.y,
    screenX: point.x,
    screenY: point.y,
  })
  node.dispatchEvent(event)

  const compatType = MOUSE_COMPAT_TYPE[type]
  if (state.mouseCompat && compatType && !event.defaultPrevented) {
    fireMouseEvent(node, compatType, point)
  }
  return event
}

/**
 * A synthetic pinch/scroll-zoom. `ctrlKey: true` is not a modifier-key claim,
 * it is the signal browsers themselves synthesize on a wheel event for a
 * trackpad pinch, and the convention React Flow, Figma and Google Maps all
 * listen for; a plain mouse-wheel zoom implementation would also accept it.
 */
export function fireWheelEvent(
  node: HTMLElement,
  point: { readonly x: number; readonly y: number },
  deltaY: number,
): WheelEvent {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: viewFor(node),
    ctrlKey: true,
    deltaY,
    deltaMode: 0, // DOM_DELTA_PIXEL
    clientX: point.x,
    clientY: point.y,
  })
  node.dispatchEvent(event)
  return event
}

/**
 * The real DOM node a gesture at `(clientX, clientY)` would start on, within
 * `container`. Prefers `elementFromPoint` so a per-element DOM arm's own node
 * receives the event exactly as a real click would; falls back to `container`
 * itself when there is nothing more specific there (a canvas arm, where the
 * canvas element covers the whole area) or when the point resolves outside
 * the container entirely (nothing laid out yet, or a jsdom test with no
 * layout engine, where `elementFromPoint` is not implemented at all).
 */
export function locateHitNode(container: HTMLElement, clientX: number, clientY: number): HTMLElement {
  const doc = container.ownerDocument
  const fromPoint = typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(clientX, clientY) : null
  if (fromPoint instanceof HTMLElement && container.contains(fromPoint)) {
    return fromPoint
  }
  return container
}

// ---- typing -------------------------------------------------------------

interface KeyInfo {
  readonly key: string
  readonly code: string
}

/**
 * `KeyboardEvent.key`/`.code` for a single typed character. Physical `code`
 * only has a defined mapping for the characters a real keyboard produces
 * directly; punctuation and anything outside ASCII letters/digits/space get
 * `'Unidentified'` for `code` rather than a guess, since nothing here reads
 * `code` for those and a wrong guess would be a silent lie in a proof trail
 * whose whole job is not to lie.
 */
export function keyInfoForChar(char: string): KeyInfo {
  if (/^[a-zA-Z]$/.test(char)) return { key: char, code: `Key${char.toUpperCase()}` }
  if (/^[0-9]$/.test(char)) return { key: char, code: `Digit${char}` }
  if (char === ' ') return { key: ' ', code: 'Space' }
  return { key: char, code: 'Unidentified' }
}

export function fireKeyEvent(node: HTMLElement, type: 'keydown' | 'keyup', char: string): KeyboardEvent {
  const info = keyInfoForChar(char)
  const event = new KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    key: info.key,
    code: info.code,
  })
  node.dispatchEvent(event)
  return event
}

export function fireBeforeInput(node: HTMLElement, char: string): InputEvent {
  const event = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    composed: true,
    inputType: 'insertText',
    data: char,
  })
  node.dispatchEvent(event)
  return event
}

export function fireInput(node: HTMLElement, char: string): InputEvent {
  const event = new InputEvent('input', {
    bubbles: true,
    cancelable: false,
    composed: true,
    inputType: 'insertText',
    data: char,
  })
  node.dispatchEvent(event)
  return event
}

/** Reads the current text of a typing target, uniformly across the two shapes it can take. */
export function readTargetText(target: HTMLElement): string {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return target.value
  return target.textContent ?? ''
}

/**
 * `isContentEditable` reflects the live `contenteditable` state in a real
 * browser, but jsdom leaves it `undefined` even with the attribute set
 * (a known jsdom gap), so this falls back to reading the attribute directly.
 */
export function isEditableContentHost(el: HTMLElement): boolean {
  if (el.isContentEditable) return true
  const attr = el.getAttribute('contenteditable')
  return attr === '' || attr === 'true'
}

/** Puts the caret at the end of a typing target's current content, before the first keystroke. */
export function placeCaretAtEnd(target: HTMLElement): void {
  target.focus()
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const end = target.value.length
    target.setSelectionRange(end, end)
    return
  }
  if (isEditableContentHost(target)) {
    const doc = target.ownerDocument
    const range = doc.createRange()
    range.selectNodeContents(target)
    range.collapse(false)
    const selection = doc.defaultView?.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }
}

/**
 * Inserts one character the way the browser's own native text insertion
 * would, for a target whose `beforeinput` handler did not call
 * `preventDefault` (meaning the app relies on native insertion rather than
 * intercepting the keystroke itself, e.g. a plain `<input>`). A rich editor
 * that owns `beforeinput` is expected to perform its own insertion inside
 * that handler, and this is skipped for it, matching what a real browser
 * does: a prevented `beforeinput` never reaches native insertion.
 */
export function insertCharNatively(target: HTMLElement, char: string): void {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const proto = target instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    const start = target.selectionStart ?? target.value.length
    const end = target.selectionEnd ?? target.value.length
    const next = target.value.slice(0, start) + char + target.value.slice(end)
    if (setter) setter.call(target, next)
    else target.value = next
    const caret = start + char.length
    target.setSelectionRange(caret, caret)
    return
  }

  if (isEditableContentHost(target)) {
    const doc = target.ownerDocument
    const selection = doc.defaultView?.getSelection()
    const existing = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
    const range = existing && target.contains(existing.commonAncestorContainer) ? existing : doc.createRange()
    if (range !== existing) {
      range.selectNodeContents(target)
      range.collapse(false)
    }
    range.deleteContents()
    const textNode = doc.createTextNode(char)
    range.insertNode(textNode)
    range.setStartAfter(textNode)
    range.collapse(true)
    selection?.removeAllRanges()
    selection?.addRange(range)
    return
  }

  // Neither a value-carrying field nor a contenteditable host: there is no
  // defined place to put the character, so this is driver misuse. Silently
  // doing nothing would look, downstream, exactly like a gesture that failed
  // to land, which is the one failure mode this whole module exists to catch.
  throw new Error('typeText target is not an input, textarea or contenteditable element')
}
