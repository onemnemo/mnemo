import { vi } from "vitest"

/**
 * The pinned jsdom implements neither ResizeObserver nor a computed `isContentEditable`, so most
 * component tests (anything using Radix's Popper, which measures with a ResizeObserver, or the
 * mindmap route guards, which read isContentEditable) needed their own stand-in. This file is the
 * one place both live, wired in through vitest's `setupFiles` so every test file gets a working
 * default without redeclaring it.
 */

class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver

// Most test files run in vitest's default node environment and never load jsdom at all, so this
// guards against the DOM globals not existing rather than assuming every file opts into jsdom.
if (typeof HTMLElement !== "undefined") {
  // jsdom reflects the `contentEditable` attribute but never computes `isContentEditable` from it,
  // so every element reports `undefined`. This mirrors the real browser computation closely enough
  // for tests: an explicit "true"/"false" wins, an empty attribute means editable, and anything else
  // falls back to the nearest ancestor that answers.
  Object.defineProperty(HTMLElement.prototype, "isContentEditable", {
    configurable: true,
    get(this: HTMLElement): boolean {
      const own = this.getAttribute("contenteditable")
      if (own === "true" || own === "") return true
      if (own === "false") return false
      const parent = this.parentElement
      return parent ? parent.isContentEditable : false
    },
  })
}

// jsdom runs no layout, so `Range` carries neither of the two box-reading
// methods an `Element` at least answers with zeros. ProseMirror measures a
// character by putting a range around it, which is how it answers where the
// caret is on screen and what it does on every scroll into view, so without
// these a floating layer cannot be placed at all and a focused editor throws on
// its next edit. Zeros, matching what jsdom already answers everywhere else:
// nothing here can report a layout that did not run.
if (typeof Range !== "undefined") {
  Range.prototype.getClientRects ??= function (): DOMRectList {
    const list = [] as unknown as DOMRectList
    return list
  }
  Range.prototype.getBoundingClientRect ??= function (): DOMRect {
    return new DOMRect(0, 0, 0, 0)
  }
}

/** One attached observer's captured callback, so a test can fire it with a specific width. */
type ResizeNotifier = (width: number) => void

export interface ResizeObserverController {
  /** Fires every currently-attached observer's callback with this width, as a real resize would. */
  trigger(width: number): void
  /** Elements currently being observed (attachments minus disconnects), for assertions. */
  readonly observedCount: number
}

/**
 * Installs a ResizeObserver that a test drives by hand, for hooks that read the reported width from
 * the observer callback rather than from the element itself. Overrides the default no-op stand-in
 * above for the current test file only; call again (or `vi.unstubAllGlobals()`) to reset it.
 */
export function installControllableResizeObserver(): ResizeObserverController {
  let notifiers: ResizeNotifier[] = []

  class ControllableResizeObserver implements ResizeObserver {
    private readonly callback: ResizeObserverCallback
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
    }
    observe(): void {
      notifiers.push((width) => {
        this.callback([{ contentRect: { width } } as ResizeObserverEntry], this)
      })
    }
    unobserve(): void {}
    disconnect(): void {
      notifiers = []
    }
  }

  vi.stubGlobal("ResizeObserver", ControllableResizeObserver)

  return {
    trigger(width: number): void {
      for (const notify of notifiers) notify(width)
    },
    get observedCount(): number {
      return notifiers.length
    },
  }
}
