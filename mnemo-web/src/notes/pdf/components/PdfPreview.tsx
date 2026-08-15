import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react"
import * as pdfjs from "pdfjs-dist"
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist"
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"

import { cn } from "@/lib/utils"

// Bundled worker, no CDN: the artifact is offline and the strict host origin would block a remote
// script anyway.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/** The gutter around and between sheets. Also the slack the fit scale has to leave for itself. */
const GAP = 20

/** PDF pages are measured in points; the browser draws in CSS pixels. */
const PX_PER_PT = 96 / 72

/** How far outside the pane a sheet starts drawing, so scrolling lands on a rendered page. */
const PRERENDER_MARGIN = "600px"

/** Lets the pager drive the scroll without the pane's ref leaving this file. */
export interface PdfPreviewHandle {
  goTo: (index: number) => void
}

/**
 * The document, laid out as a scrolling stack of sheets rather than one page at a time: paging with
 * arrows through something you cannot scroll is the one thing a PDF viewer never asks of you.
 *
 * Two zoom levels, and they answer different questions. *Fit* shows a whole page: where the breaks
 * fall, how the margins sit, whether a figure ended up alone at the bottom. *100%* shows the type at
 * the size it will print, which is the only way to judge 10 pt against 11.
 */
export function PdfPreview({
  data,
  zoom,
  handleRef,
  onLoaded,
  onView,
  onError,
}: {
  data: ArrayBuffer | null
  zoom: "fit" | "full"
  handleRef?: RefObject<PdfPreviewHandle | null>
  /** Reports the page count up so the status line and the pager can bound themselves. */
  onLoaded: (pageCount: number) => void
  /** The page the scroll position is on, zero-based. */
  onView: (index: number) => void
  onError: () => void
}) {
  const paneRef = useRef<HTMLDivElement | null>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  // The first page at 100%, in CSS pixels. Every sheet is drawn to this so a stack stays a stack.
  const [sheet, setSheet] = useState({ w: 0, h: 0 })
  const [box, setBox] = useState({ w: 0, h: 0 })

  // Held in refs so a caller that re-creates its handlers each render does not reload the document.
  const callbacks = useRef({ onLoaded, onView, onError })
  callbacks.current = { onLoaded, onView, onError }

  // Load (or replace) the document whenever the bytes change.
  useEffect(() => {
    let cancelled = false
    let task: ReturnType<typeof pdfjs.getDocument> | null = null

    void (async () => {
      if (!data) {
        setDoc(null)
        return
      }
      try {
        // Clone: getDocument takes ownership of the buffer and would detach the caller's copy,
        // which is still needed if the same bytes are handed to a second viewer.
        task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) })
        const loaded = await task.promise
        // The cleanup below has already torn the task down, and with it this document.
        if (cancelled) return
        const first = await loaded.getPage(1)
        const viewport = first.getViewport({ scale: PX_PER_PT })
        setSheet({ w: viewport.width, h: viewport.height })
        setDoc(loaded)
        callbacks.current.onLoaded(loaded.numPages)
      } catch {
        if (!cancelled) callbacks.current.onError()
      }
    })()

    return () => {
      cancelled = true
      // Destroying the loading task tears the document down with it.
      void task?.destroy().catch(() => undefined)
    }
  }, [data])

  useLayoutEffect(() => {
    const el = paneRef.current
    if (!el) return
    // Measured here as well as observed: the observer's first callback arrives with the next frame,
    // and a page drawn at the fallback scale for one frame reads as the dialog opening at the wrong
    // size and correcting itself.
    setBox({ w: el.clientWidth, h: el.clientHeight })
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(([entry]) =>
      setBox({ w: entry.contentRect.width, h: entry.contentRect.height }),
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const fit =
    sheet.w > 0 && box.w > 0
      ? Math.max(0.15, Math.min((box.w - GAP * 2) / sheet.w, (box.h - GAP * 2) / sheet.h))
      : 1
  const factor = zoom === "fit" ? fit : 1
  const width = sheet.w * factor
  const height = sheet.h * factor
  const step = height + GAP

  // The pager scrolls the stack; the stack, not the pager, is what says which page you are on.
  const stepRef = useRef(step)
  stepRef.current = step
  useEffect(() => {
    if (!handleRef) return
    handleRef.current = {
      goTo: (index) => paneRef.current?.scrollTo({ top: index * stepRef.current, behavior: "smooth" }),
    }
    return () => {
      handleRef.current = null
    }
  }, [handleRef])

  return (
    <div
      ref={paneRef}
      onScroll={() => {
        const el = paneRef.current
        if (!el || !doc || step <= 0) return
        callbacks.current.onView(Math.max(0, Math.min(doc.numPages - 1, Math.round(el.scrollTop / step))))
      }}
      className={cn(
        "scroll-thin min-h-0 flex-1 overflow-auto",
        // Snapping only while a whole page fits. At 100% the sheet is taller than the pane, and a
        // snap point in the middle of it fights you every time you read the bottom of a page.
        zoom === "fit" && "snap-y snap-mandatory",
      )}
    >
      <div className="flex w-max min-w-full flex-col items-center" style={{ gap: GAP, padding: GAP }}>
        {doc && width > 0
          ? Array.from({ length: doc.numPages }, (_, index) => (
              <Sheet
                key={index}
                doc={doc}
                pageNumber={index + 1}
                width={width}
                height={height}
                root={paneRef.current}
                snap={zoom === "fit"}
                onError={onError}
              />
            ))
          : null}
      </div>
    </div>
  )
}

/**
 * One page. Blank paper until it comes near the pane, so a long note costs a rasterization per page
 * you actually look at rather than one per page it has.
 */
function Sheet({
  doc,
  pageNumber,
  width,
  height,
  root,
  snap,
  onError,
}: {
  doc: PDFDocumentProxy
  pageNumber: number
  width: number
  height: number
  root: HTMLElement | null
  snap: boolean
  onError: () => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // Page one is at the top of the stack, so it is in view the moment the document loads. Drawing it
  // without waiting to be told keeps the first sheet off the observer's first callback, which is a
  // frame away at best and never arrives at all while the window is not compositing.
  const [near, setNear] = useState(pageNumber === 1)

  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof IntersectionObserver === "undefined") {
      setNear(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        // One-way: a page that has been drawn stays drawn. Discarding it would mean scrolling back
        // through a document you have already seen and watching it redraw.
        if (entry.isIntersecting) setNear(true)
      },
      { root, rootMargin: PRERENDER_MARGIN },
    )
    observer.observe(host)
    return () => observer.disconnect()
  }, [root])

  useEffect(() => {
    if (!near || width <= 0) return
    let cancelled = false
    let task: RenderTask | null = null

    void (async () => {
      try {
        const page = await doc.getPage(pageNumber)
        const canvas = canvasRef.current
        const context = canvas?.getContext("2d")
        if (cancelled || !canvas || !context) return

        // Drawn at the device's pixel density and scaled back down by CSS, so type stays crisp on a
        // high-DPI screen. Capped at 2: past that the sharpening is invisible and the memory is not.
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const unscaled = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: (width / unscaled.width) * dpr })
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)

        task = page.render({ canvas, canvasContext: context, viewport })
        await task.promise
      } catch (error) {
        // A superseded render throws RenderingCancelledException; only surface anything else.
        if (!cancelled && !isCancellation(error)) onError()
      }
    })()

    return () => {
      cancelled = true
      task?.cancel()
    }
    // onError is stable enough not to drive a re-render of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageNumber, width, near])

  return (
    <div
      ref={hostRef}
      style={{
        width,
        height,
        // Not shadow-pop: that shadow is tuned to lift a panel off the app's canvas. A sheet of
        // paper wants a plain, slightly heavier drop.
        boxShadow: "0 1px 2px rgb(0 0 0 / 0.14), 0 8px 24px rgb(0 0 0 / 0.12)",
      }}
      className={cn("relative shrink-0 overflow-hidden bg-white", snap && "snap-center")}
    >
      <canvas ref={canvasRef} className="block size-full" />
    </div>
  )
}

function isCancellation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "RenderingCancelledException"
  )
}
