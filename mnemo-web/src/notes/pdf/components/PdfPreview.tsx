import { useEffect, useRef } from "react"
import * as pdfjs from "pdfjs-dist"
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist"
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"

// Bundled worker, no CDN: the artifact is offline and the strict host origin would block a remote
// script anyway.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/**
 * Renders one page of a PDF (given as bytes) to a canvas, fit to its container width and sharpened
 * for the device pixel ratio. Loads the document once per byte payload and re-renders on page or
 * size changes; reports the page count up so the pager can bound itself.
 */
export function PdfPreview({
  data,
  pageNumber,
  onLoaded,
  onError,
}: {
  data: ArrayBuffer | null
  pageNumber: number
  onLoaded: (pageCount: number) => void
  onError: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const docRef = useRef<PDFDocumentProxy | null>(null)
  const loadingTaskRef = useRef<ReturnType<typeof pdfjs.getDocument> | null>(null)
  const renderTaskRef = useRef<RenderTask | null>(null)
  // Only the newest render is allowed to finish; the load effect, page effect, and resize observer
  // all trigger renders and pdf.js forbids two at once on one canvas.
  const renderTokenRef = useRef(0)

  // Load (or replace) the document whenever the bytes change.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      await destroyDoc(docRef, loadingTaskRef, renderTaskRef)
      if (!data) return
      try {
        // Clone: getDocument takes ownership of the buffer and would detach the caller's copy,
        // which is still needed to re-render other pages.
        const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) })
        loadingTaskRef.current = task
        const doc = await task.promise
        if (cancelled) {
          void task.destroy()
          return
        }
        docRef.current = doc
        onLoaded(doc.numPages)
        await renderCurrentPage()
      } catch {
        if (!cancelled) onError()
      }
    })()
    return () => {
      cancelled = true
    }
    // renderCurrentPage is stable enough for this effect's purposes; page/size handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  // Re-render on page change.
  useEffect(() => {
    void renderCurrentPage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNumber])

  // Re-render on container resize so the page stays fit to width.
  useEffect(() => {
    const host = canvasRef.current?.parentElement
    if (!host || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => void renderCurrentPage())
    observer.observe(host)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function renderCurrentPage() {
    const doc = docRef.current
    const canvas = canvasRef.current
    const host = canvas?.parentElement
    if (!doc || !canvas || !host) return

    const token = ++renderTokenRef.current

    // Supersede any render already on this canvas and wait for it to release before starting.
    const previous = renderTaskRef.current
    renderTaskRef.current = null
    if (previous) {
      previous.cancel()
      await previous.promise.catch(() => undefined)
    }
    if (token !== renderTokenRef.current) return

    const clamped = Math.min(Math.max(pageNumber, 1), doc.numPages)
    const page = await doc.getPage(clamped)
    if (token !== renderTokenRef.current) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const unscaled = page.getViewport({ scale: 1 })
    const targetWidth = Math.max(1, host.clientWidth)
    const viewport = page.getViewport({ scale: (targetWidth / unscaled.width) * dpr })

    const context = canvas.getContext("2d")
    if (!context) return
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    canvas.style.width = "100%"
    canvas.style.height = "auto"

    const task = page.render({ canvas, canvasContext: context, viewport })
    renderTaskRef.current = task
    try {
      await task.promise
    } catch (error) {
      // A superseded render throws RenderingCancelledException; only surface anything else.
      if (!isCancellation(error)) onError()
    } finally {
      if (renderTaskRef.current === task) renderTaskRef.current = null
    }
  }

  // Tear the document down when the component leaves.
  useEffect(() => () => void destroyDoc(docRef, loadingTaskRef, renderTaskRef), [])

  return (
    <canvas
      ref={canvasRef}
      className="block w-full rounded-[3px] bg-white shadow-[0_8px_22px_0_rgba(0,0,0,0.16)]"
    />
  )
}

function isCancellation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: string }).name === "RenderingCancelledException"
}

async function destroyDoc(
  docRef: { current: PDFDocumentProxy | null },
  taskRef: { current: ReturnType<typeof pdfjs.getDocument> | null },
  renderRef: { current: RenderTask | null },
) {
  renderRef.current?.cancel()
  renderRef.current = null
  const task = taskRef.current
  taskRef.current = null
  docRef.current = null
  if (task) {
    try {
      // Destroying the loading task tears the document down with it.
      await task.destroy()
    } catch {
      // Already gone; nothing to free.
    }
  }
}
