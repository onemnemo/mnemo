// @vitest-environment jsdom

/**
 * Mounts the row over a stubbed API. The pure tests cover what a result means; what is worth
 * pinning here is the wiring around it: that a fit is only offered for a preset that exists, that
 * applying sends the fitted vector rather than the one already running, that the way back to the
 * defaults sends nothing at all, and that closing the dialog stops a fit in progress.
 */

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { OptimizeWeightsDto, PresetDto } from "@/api/types"

import { PresetOptimizer } from "./PresetOptimizer"

const FITTED = [0.3, 1.4, 2.5]
const RUNNING = [0.2, 1.3, 2.3]

const mocks = vi.hoisted(() => ({
  optimizePreset: vi.fn(),
  applyPresetWeights: vi.fn(async () => ({}) as PresetDto),
  refresh: vi.fn(async () => {}),
  weights: null as number[] | null,
}))

vi.mock("../api", () => ({
  optimizePreset: mocks.optimizePreset,
  applyPresetWeights: mocks.applyPresetWeights,
  usePresetsQuery: () => ({ data: [{ id: "preset-standard", weights: mocks.weights }] }),
  useRefreshAfterPresetWrite: () => mocks.refresh,
}))

vi.mock("@/i18n/useT", () => ({
  // Keys stand in for the copy, with the substituted values appended so a count can be asserted.
  useT: () => (_ns: string, key: string, params?: Record<string, string | number>) =>
    params ? `${key} ${Object.values(params).join(",")}` : key,
}))

vi.mock("@/stores/toast", () => ({
  toast: { warning: vi.fn(), success: vi.fn() },
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function result(patch: Partial<OptimizeWeightsDto> = {}): OptimizeWeightsDto {
  return {
    status: "fitted",
    currentWeights: RUNNING,
    weights: FITTED,
    reviewsAvailable: 4200,
    reviewsUsed: 3900,
    reviewsScored: 3100,
    minimumReviews: 400,
    lossBefore: 0.5,
    lossAfter: 0.4,
    ...patch,
  }
}

let container: HTMLElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  mocks.weights = null
  mocks.optimizePreset.mockResolvedValue(result())
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function mount(node: ReactNode): void {
  act(() => root.render(node))
}

async function settle(): Promise<void> {
  await act(async () => {})
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function button(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((el) => el.textContent === label)
}

async function click(label: string): Promise<void> {
  act(() => button(label)?.click())
  await settle()
}

describe("PresetOptimizer", () => {
  it("has nothing to fit for a preset that was never saved", async () => {
    mount(<PresetOptimizer presetId={null} />)
    await settle()

    expect(button("ReviewSettingsOptimizeAction")?.disabled).toBe(true)
    expect(container.textContent).toContain("ReviewSettingsOptimizeUnsaved")
    expect(mocks.optimizePreset).not.toHaveBeenCalled()
  })

  it("reports how much history is still missing, and offers nothing to apply", async () => {
    mocks.optimizePreset.mockResolvedValue(
      result({ status: "not-enough-reviews", reviewsScored: 120, lossBefore: null, lossAfter: null }),
    )
    mount(<PresetOptimizer presetId="preset-standard" />)
    await click("ReviewSettingsOptimizeAction")

    expect(container.textContent).toContain("ReviewSettingsOptimizeNotEnoughFormat 120,400")
    expect(button("ReviewSettingsOptimizeApply")).toBeUndefined()
  })

  it("offers a better fit with the gain it measured", async () => {
    mount(<PresetOptimizer presetId="preset-standard" />)
    await click("ReviewSettingsOptimizeAction")

    expect(container.textContent).toContain("ReviewSettingsOptimizeImprovedFormat 3100,20")
    expect(button("ReviewSettingsOptimizeApply")).toBeDefined()
  })

  it("applies the fitted vector, not the one already running", async () => {
    mount(<PresetOptimizer presetId="preset-standard" />)
    await click("ReviewSettingsOptimizeAction")
    await click("ReviewSettingsOptimizeApply")

    expect(mocks.applyPresetWeights).toHaveBeenCalledWith("preset-standard", FITTED)
    // Every deck on this preset now schedules differently, so the caches over them are stale.
    expect(mocks.refresh).toHaveBeenCalled()
    expect(button("ReviewSettingsOptimizeApply")).toBeUndefined()
  })

  it("does not offer a result that only reproduces the running vector", async () => {
    mocks.optimizePreset.mockResolvedValue(result({ weights: RUNNING }))
    mount(<PresetOptimizer presetId="preset-standard" />)
    await click("ReviewSettingsOptimizeAction")

    expect(container.textContent).toContain("ReviewSettingsOptimizeAlreadyTuned")
    expect(button("ReviewSettingsOptimizeApply")).toBeUndefined()
  })

  it("leaves a preset on the defaults with nothing to restore", async () => {
    mount(<PresetOptimizer presetId="preset-standard" />)
    await settle()

    expect(button("ReviewSettingsWeightsUseDefaults")).toBeUndefined()
  })

  it("puts a fitted preset back on the published defaults", async () => {
    mocks.weights = FITTED
    mount(<PresetOptimizer presetId="preset-standard" />)
    await settle()

    expect(container.textContent).toContain("ReviewSettingsWeightsCustomDescription")
    await click("ReviewSettingsWeightsUseDefaults")

    expect(mocks.applyPresetWeights).toHaveBeenCalledWith("preset-standard", null)
  })

  it("stops a running fit when the dialog closes", async () => {
    let signal: AbortSignal | undefined
    mocks.optimizePreset.mockImplementation(
      (_id: string, given: AbortSignal) =>
        new Promise<OptimizeWeightsDto>(() => {
          signal = given
        }),
    )

    mount(<PresetOptimizer presetId="preset-standard" />)
    await click("ReviewSettingsOptimizeAction")
    expect(signal?.aborted).toBe(false)

    act(() => root.render(null))

    expect(signal?.aborted).toBe(true)
  })
})
