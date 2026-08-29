// @vitest-environment jsdom

/**
 * Checks when unsaved work triggers the browser leave-page confirmation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { onDirtyCheck, onShutdown, onShutdownGuard, resetShutdownForTests } from "./shutdown"
import { installUnloadBackstop } from "./unload-backstop"

let dispose: (() => void) | undefined

beforeEach(() => {
  resetShutdownForTests()
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  vi.restoreAllMocks()
})

function leaving(): boolean {
  const event = new Event("beforeunload", { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

describe("installUnloadBackstop", () => {
  it("raises the prompt while a source is holding unsaved work", () => {
    onDirtyCheck(() => true)
    dispose = installUnloadBackstop()

    expect(leaving()).toBe(true)
  })

  it("stays out of the way when nothing is dirty, exit prompt registered and all", () => {
    onShutdownGuard(async () => true)
    onShutdown(async () => undefined)
    onDirtyCheck(() => false)
    dispose = installUnloadBackstop()

    expect(leaving()).toBe(false)
  })

  it("asks every source rather than stopping at the first clean one", () => {
    onDirtyCheck(() => false)
    onDirtyCheck(() => true)
    dispose = installUnloadBackstop()

    expect(leaving()).toBe(true)
  })

  // Treat a failed probe as dirty to avoid silently discarding work.
  it("reads a source that fails as unsaved", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    onDirtyCheck(() => {
      throw new Error("probe is broken")
    })
    onDirtyCheck(() => false)
    dispose = installUnloadBackstop()

    expect(leaving()).toBe(true)
  })

  it("stops asking once a source unregisters", () => {
    const unregister = onDirtyCheck(() => true)
    dispose = installUnloadBackstop()

    expect(leaving()).toBe(true)
    unregister()
    expect(leaving()).toBe(false)
  })

  it("stops asking once disposed", () => {
    onDirtyCheck(() => true)
    installUnloadBackstop()()

    expect(leaving()).toBe(false)
  })
})
