// @vitest-environment jsdom

/**
 * The sidebar's resting state: closed on a profile that has never touched it,
 * and afterwards whatever it was last left as. The store reads storage once
 * at module load, so each case imports it afresh.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const KEY = "mnemo.shell.sidebarCollapsed"

async function freshStore() {
  vi.resetModules()
  return (await import("./shell")).useShellStore
}

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

describe("the sidebar's resting state", () => {
  it("starts closed when nothing has been chosen", async () => {
    const store = await freshStore()
    expect(store.getState().sidebarCollapsed).toBe(true)
  })

  it("remembers being opened across a restart", async () => {
    const first = await freshStore()
    first.getState().toggleSidebar()
    expect(first.getState().sidebarCollapsed).toBe(false)
    expect(localStorage.getItem(KEY)).toBe("false")

    const second = await freshStore()
    expect(second.getState().sidebarCollapsed).toBe(false)
  })

  it("remembers being closed again", async () => {
    localStorage.setItem(KEY, "false")
    const store = await freshStore()
    store.getState().setSidebarCollapsed(true)

    expect((await freshStore()).getState().sidebarCollapsed).toBe(true)
  })

  it("treats anything but a plain false as closed", async () => {
    localStorage.setItem(KEY, "sideways")
    expect((await freshStore()).getState().sidebarCollapsed).toBe(true)
  })
})
