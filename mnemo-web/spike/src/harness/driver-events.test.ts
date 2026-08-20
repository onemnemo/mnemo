// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import {
  fireBeforeInput,
  fireInput,
  fireKeyEvent,
  fireMouseEvent,
  firePointerEvent,
  fireWheelEvent,
  insertCharNatively,
  isEditableContentHost,
  keyInfoForChar,
  locateHitNode,
  nextPointerId,
  placeCaretAtEnd,
  readTargetText,
  type PointerDispatchState,
} from './driver-events'

afterEach(() => {
  document.body.replaceChildren()
})

describe('nextPointerId', () => {
  it('returns increasing, distinct ids across calls', () => {
    const a = nextPointerId()
    const b = nextPointerId()
    const c = nextPointerId()
    expect(b).toBeGreaterThan(a)
    expect(c).toBeGreaterThan(b)
  })
})

describe('firePointerEvent', () => {
  const state: PointerDispatchState = { pointerId: 42, pointerType: 'mouse', mouseCompat: false }
  const withCompat: PointerDispatchState = { ...state, mouseCompat: true }

  it('dispatches at the exact node passed in, never at window or document', () => {
    const node = document.createElement('div')
    document.body.appendChild(node)

    let onNode = 0
    let onWindow = 0
    let onDocument = 0
    node.addEventListener('pointerdown', () => {
      onNode += 1
    })
    // window and document listeners exist only to prove the event still bubbles to them
    // through the real DOM tree, not that it was dispatched there directly.
    window.addEventListener('pointerdown', () => {
      onWindow += 1
    })
    document.addEventListener('pointerdown', () => {
      onDocument += 1
    })

    firePointerEvent(node, 'pointerdown', { x: 10, y: 10 }, state)

    expect(onNode).toBe(1)
    expect(onWindow).toBe(1) // bubbled up, not dispatched there
    expect(onDocument).toBe(1)
  })

  it('carries a stable pointerId, isPrimary and clientX/Y consistent with the gesture', () => {
    const node = document.createElement('div')
    document.body.appendChild(node)
    let seen: PointerEvent | null = null
    node.addEventListener('pointerdown', (e) => {
      seen = e as PointerEvent
    })

    firePointerEvent(node, 'pointerdown', { x: 123, y: 45 }, state)

    expect(seen).not.toBeNull()
    const event = seen as unknown as PointerEvent
    expect(event.pointerId).toBe(42)
    expect(event.pointerType).toBe('mouse')
    expect(event.isPrimary).toBe(true)
    expect(event.clientX).toBe(123)
    expect(event.clientY).toBe(45)
  })

  it('reports buttons=1 while pressed (down/move) and buttons=0 on release', () => {
    const node = document.createElement('div')
    const seen: number[] = []
    node.addEventListener('pointerdown', (e) => seen.push((e as PointerEvent).buttons))
    node.addEventListener('pointermove', (e) => seen.push((e as PointerEvent).buttons))
    node.addEventListener('pointerup', (e) => seen.push((e as PointerEvent).buttons))

    firePointerEvent(node, 'pointerdown', { x: 0, y: 0 }, state)
    firePointerEvent(node, 'pointermove', { x: 5, y: 5 }, state)
    firePointerEvent(node, 'pointerup', { x: 10, y: 10 }, state)

    expect(seen).toEqual([1, 1, 0])
  })

  it('reuses the same pointerId across down/move/up so pointerId-filtering handlers accept the whole sequence', () => {
    const node = document.createElement('div')
    const ids: number[] = []
    for (const type of ['pointerdown', 'pointermove', 'pointerup'] as const) {
      node.addEventListener(type, (e) => ids.push((e as PointerEvent).pointerId))
    }
    firePointerEvent(node, 'pointerdown', { x: 0, y: 0 }, state)
    firePointerEvent(node, 'pointermove', { x: 1, y: 1 }, state)
    firePointerEvent(node, 'pointerup', { x: 2, y: 2 }, state)
    expect(new Set(ids).size).toBe(1)
  })

  it('follows each pointer event with its mouse-compatibility twin, as a real user agent does', () => {
    // d3-drag and d3-zoom, which React Flow's pan and node drag are built on, bind mouse
    // events. A pointer-only driver reaches such an arm not at all.
    const node = document.createElement('div')
    document.body.appendChild(node)
    const seen: string[] = []
    for (const type of ['pointerdown', 'mousedown', 'pointermove', 'mousemove', 'pointerup', 'mouseup'] as const) {
      node.addEventListener(type, () => seen.push(type))
    }

    firePointerEvent(node, 'pointerdown', { x: 1, y: 1 }, withCompat)
    firePointerEvent(node, 'pointermove', { x: 2, y: 2 }, withCompat)
    firePointerEvent(node, 'pointerup', { x: 3, y: 3 }, withCompat)

    expect(seen).toEqual(['pointerdown', 'mousedown', 'pointermove', 'mousemove', 'pointerup', 'mouseup'])
  })

  it('suppresses the compat event when the pointer event was prevented, matching the platform', () => {
    const node = document.createElement('div')
    document.body.appendChild(node)
    node.addEventListener('pointerdown', (e) => e.preventDefault())
    let mousedowns = 0
    node.addEventListener('mousedown', () => {
      mousedowns += 1
    })

    firePointerEvent(node, 'pointerdown', { x: 1, y: 1 }, withCompat)
    expect(mousedowns).toBe(0)
  })

  it('never emits a compat twin for pointercancel, which is the cancelled-gesture case', () => {
    const node = document.createElement('div')
    document.body.appendChild(node)
    const seen: string[] = []
    for (const type of ['mousedown', 'mousemove', 'mouseup'] as const) {
      node.addEventListener(type, () => seen.push(type))
    }
    firePointerEvent(node, 'pointercancel', { x: 1, y: 1 }, withCompat)
    expect(seen).toEqual([])
  })
})

describe('fireMouseEvent', () => {
  it('reports buttons=1 while pressed and 0 on release, and never synthesizes a click', () => {
    const node = document.createElement('div')
    document.body.appendChild(node)
    const buttons: number[] = []
    let clicks = 0
    for (const type of ['mousedown', 'mousemove', 'mouseup'] as const) {
      node.addEventListener(type, (e) => buttons.push((e as MouseEvent).buttons))
    }
    node.addEventListener('click', () => {
      clicks += 1
    })

    fireMouseEvent(node, 'mousedown', { x: 0, y: 0 })
    fireMouseEvent(node, 'mousemove', { x: 1, y: 1 })
    fireMouseEvent(node, 'mouseup', { x: 2, y: 2 })

    expect(buttons).toEqual([1, 1, 0])
    // A click in the middle of a measured window would toggle selection or open an editor.
    expect(clicks).toBe(0)
  })
})

describe('fireWheelEvent', () => {
  it('sets ctrlKey (the pinch-zoom convention) and carries the given deltaY', () => {
    const node = document.createElement('div')
    let seen: WheelEvent | null = null
    node.addEventListener('wheel', (e) => {
      seen = e as WheelEvent
    })
    fireWheelEvent(node, { x: 1, y: 2 }, -240)
    const event = seen as unknown as WheelEvent
    expect(event.ctrlKey).toBe(true)
    expect(event.deltaY).toBe(-240)
    expect(event.clientX).toBe(1)
    expect(event.clientY).toBe(2)
  })
})

describe('locateHitNode', () => {
  it('falls back to the container when elementFromPoint is unavailable (jsdom has no layout engine)', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    expect(typeof document.elementFromPoint).toBe('undefined')
    expect(locateHitNode(container, 50, 50)).toBe(container)
  })

  it('prefers a more specific descendant when elementFromPoint resolves inside the container', () => {
    const container = document.createElement('div')
    const child = document.createElement('span')
    container.appendChild(child)
    document.body.appendChild(container)

    const original = (document as { elementFromPoint?: unknown }).elementFromPoint
    ;(document as unknown as { elementFromPoint: () => Element }).elementFromPoint = () => child
    try {
      expect(locateHitNode(container, 5, 5)).toBe(child)
    } finally {
      if (original === undefined) {
        delete (document as { elementFromPoint?: unknown }).elementFromPoint
      } else {
        ;(document as unknown as { elementFromPoint: unknown }).elementFromPoint = original
      }
    }
  })

  it('falls back to the container when elementFromPoint resolves outside it', () => {
    const container = document.createElement('div')
    const outsider = document.createElement('span')
    document.body.appendChild(container)
    document.body.appendChild(outsider)

    const original = (document as { elementFromPoint?: unknown }).elementFromPoint
    ;(document as unknown as { elementFromPoint: () => Element }).elementFromPoint = () => outsider
    try {
      expect(locateHitNode(container, 5, 5)).toBe(container)
    } finally {
      if (original === undefined) {
        delete (document as { elementFromPoint?: unknown }).elementFromPoint
      } else {
        ;(document as unknown as { elementFromPoint: unknown }).elementFromPoint = original
      }
    }
  })
})

describe('keyInfoForChar', () => {
  it('maps letters to Key<Upper> codes', () => {
    expect(keyInfoForChar('a')).toEqual({ key: 'a', code: 'KeyA' })
    expect(keyInfoForChar('Z')).toEqual({ key: 'Z', code: 'KeyZ' })
  })

  it('maps digits to Digit<n> codes', () => {
    expect(keyInfoForChar('7')).toEqual({ key: '7', code: 'Digit7' })
  })

  it('maps space to the Space code', () => {
    expect(keyInfoForChar(' ')).toEqual({ key: ' ', code: 'Space' })
  })

  it('falls back to Unidentified for punctuation rather than guessing a physical key', () => {
    expect(keyInfoForChar('#')).toEqual({ key: '#', code: 'Unidentified' })
  })
})

describe('fireKeyEvent / fireBeforeInput / fireInput', () => {
  it('carries the mapped key/code on keydown and keyup', () => {
    const node = document.createElement('input')
    const seen: { key: string; code: string }[] = []
    node.addEventListener('keydown', (e) => seen.push({ key: (e as KeyboardEvent).key, code: (e as KeyboardEvent).code }))
    node.addEventListener('keyup', (e) => seen.push({ key: (e as KeyboardEvent).key, code: (e as KeyboardEvent).code }))
    fireKeyEvent(node, 'keydown', 'q')
    fireKeyEvent(node, 'keyup', 'q')
    expect(seen).toEqual([
      { key: 'q', code: 'KeyQ' },
      { key: 'q', code: 'KeyQ' },
    ])
  })

  it('fires a cancelable insertText beforeinput and a non-cancelable input, both carrying data', () => {
    const node = document.createElement('input')
    const before = fireBeforeInput(node, 'x')
    const input = fireInput(node, 'x')
    expect(before.inputType).toBe('insertText')
    expect(before.data).toBe('x')
    expect(before.cancelable).toBe(true)
    expect(input.inputType).toBe('insertText')
    expect(input.data).toBe('x')
    expect(input.cancelable).toBe(false)
  })

  it('beforeinput can be prevented by a listener, which is how a rich editor claims the keystroke', () => {
    const node = document.createElement('div')
    node.addEventListener('beforeinput', (e) => e.preventDefault())
    const event = fireBeforeInput(node, 'x')
    expect(event.defaultPrevented).toBe(true)
  })
})

describe('isEditableContentHost', () => {
  it('is false for a plain element and true once contenteditable is set', () => {
    const el = document.createElement('div')
    expect(isEditableContentHost(el)).toBe(false)
    el.setAttribute('contenteditable', 'true')
    expect(isEditableContentHost(el)).toBe(true)
  })

  it('treats a bare contenteditable="" attribute as editable too', () => {
    const el = document.createElement('div')
    el.setAttribute('contenteditable', '')
    expect(isEditableContentHost(el)).toBe(true)
  })
})

describe('readTargetText', () => {
  it('reads .value for inputs and textareas', () => {
    const input = document.createElement('input')
    input.value = 'hello'
    expect(readTargetText(input)).toBe('hello')

    const textarea = document.createElement('textarea')
    textarea.value = 'world'
    expect(readTargetText(textarea)).toBe('world')
  })

  it('reads textContent for anything else', () => {
    const div = document.createElement('div')
    div.textContent = 'plain'
    expect(readTargetText(div)).toBe('plain')
  })
})

describe('placeCaretAtEnd + insertCharNatively', () => {
  it('inserts at the end of an <input> and advances the caret so successive chars append in order', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    placeCaretAtEnd(input)
    insertCharNatively(input, 'a')
    insertCharNatively(input, 'b')
    insertCharNatively(input, 'c')
    expect(input.value).toBe('abc')
    expect(input.selectionStart).toBe(3)
  })

  it('inserts at the current caret, not always at the end, when selectionStart is mid-string', () => {
    const input = document.createElement('input')
    input.value = 'ac'
    input.setSelectionRange(1, 1)
    insertCharNatively(input, 'b')
    expect(input.value).toBe('abc')
  })

  it('inserts into a textarea the same way as an input', () => {
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    placeCaretAtEnd(textarea)
    insertCharNatively(textarea, 'x')
    insertCharNatively(textarea, 'y')
    expect(textarea.value).toBe('xy')
  })

  it('inserts into a contenteditable host in order, building up the full string', () => {
    const div = document.createElement('div')
    div.setAttribute('contenteditable', 'true')
    document.body.appendChild(div)
    placeCaretAtEnd(div)
    insertCharNatively(div, 'h')
    insertCharNatively(div, 'i')
    expect(div.textContent).toBe('hi')
  })

  it('throws rather than silently doing nothing for a target with nowhere to put the character', () => {
    const div = document.createElement('div') // not an input/textarea, not contenteditable
    expect(() => insertCharNatively(div, 'x')).toThrow()
  })
})
