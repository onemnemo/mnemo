// @vitest-environment jsdom

/**
 * The split's own contract: the gate renders nothing until the store holds a target, and once it
 * does, the dialog's lazily-loaded content actually mounts. `PdfPreview` is stubbed out here - it
 * is the whole reason this overlay is split off on its own, since it statically pulls in all of
 * pdfjs-dist, and a unit test proving the gate's wiring has no need to pay for that. The real
 * import is exercised in the browser measurement instead.
 */

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { NotePdfExportOverlay } from "./NotePdfExportOverlay"
import { useNotePdf } from "./store"

vi.mock("./api", () => ({
  fetchNotePdfPreview: vi.fn(async () => new ArrayBuffer(0)),
  saveNotePdf: vi.fn(),
}))

vi.mock("./components/PdfPreview", () => ({
  PdfPreview: () => <div data-testid="pdf-preview-stub" />,
}))

vi.mock("@/i18n/useT", () => ({
  useT: () => (_ns: string, key: string) => key,
}))

vi.mock("@/stores/toast", () => ({
  toast: { warning: vi.fn(), info: vi.fn(), success: vi.fn() },
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Transforming the dialog's chunk for the first time can outrun the default test timeout on a
// busy machine running the whole suite at once, so that cost is paid here, once, on its own
// generous budget, rather than inside whichever test happens to run first.
beforeAll(async () => {
  await import("./NotePdfExport")
}, 30000)

let container: HTMLElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  useNotePdf.setState({ target: null })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function mount(node: ReactNode): void {
  act(() => root.render(node))
}

async function settle(): Promise<void> {
  // The dialog is a lazy import behind the gate's own Suspense boundary, so the first flush
  // after opening has to wait on that chunk rather than assume a synchronous render tree.
  await act(async () => {
    await import("./NotePdfExport")
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe("NotePdfExportOverlay gate", () => {
  it("renders nothing until the store holds a target", () => {
    mount(<NotePdfExportOverlay />)

    expect(container.innerHTML).toBe("")
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it("mounts the dialog's lazily-loaded content once a target is set", async () => {
    act(() => useNotePdf.getState().open({ noteId: "n1", title: "My note" }))
    mount(<NotePdfExportOverlay />)
    await settle()

    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.body.textContent).toContain("PdfExportTitle")
    expect(document.querySelector('[data-testid="pdf-preview-stub"]')).not.toBeNull()
  })
})
