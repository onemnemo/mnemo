// @vitest-environment jsdom

/**
 * The split's own contract: the gate renders nothing until the store holds a target, and once it
 * does, the dialog's lazily-loaded content actually mounts. The dialog's own behaviour is not
 * this file's concern - it has its coverage elsewhere - this is only the wiring the split adds.
 */

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { ReviewSettingsOverlay } from "./ReviewSettingsOverlay"
import { useReviewSettings } from "./store"

vi.mock("./api", () => ({
  usePresetsQuery: () => ({ data: undefined, isError: false }),
  useDeckPresetQuery: () => ({ data: undefined, isError: false }),
  useRefreshAfterPresetWrite: () => vi.fn(),
  assignDeckPreset: vi.fn(),
  createPreset: vi.fn(),
  deletePreset: vi.fn(),
  updatePreset: vi.fn(),
}))

vi.mock("@/i18n/useT", () => ({
  useT: () => (_ns: string, key: string) => key,
}))

vi.mock("@/stores/dialog", () => ({
  dialog: { confirm: vi.fn(async () => false) },
}))

vi.mock("@/stores/toast", () => ({
  toast: { warning: vi.fn(), info: vi.fn(), success: vi.fn() },
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Transforming the dialog's chunk for the first time can outrun the default test timeout on a
// busy machine running the whole suite at once, so that cost is paid here, once, on its own
// generous budget, rather than inside whichever test happens to run first.
beforeAll(async () => {
  await import("./ReviewSettings")
}, 30000)

let container: HTMLElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  useReviewSettings.setState({ target: null })
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
    await import("./ReviewSettings")
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe("ReviewSettingsOverlay gate", () => {
  it("renders nothing until the store holds a target", () => {
    mount(<ReviewSettingsOverlay />)

    expect(container.innerHTML).toBe("")
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it("mounts the dialog's lazily-loaded content once a target is set", async () => {
    act(() => useReviewSettings.getState().open(null, null))
    mount(<ReviewSettingsOverlay />)
    await settle()

    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.body.textContent).toContain("ReviewSettingsTitle")
  })
})
