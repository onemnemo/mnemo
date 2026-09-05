// @vitest-environment jsdom

/**
 * The peek's shape is the part of it that survives a restart, so it is checked against
 * real storage: what is written on each change, what comes back, and what happens when
 * what comes back is nonsense. The item is checked for the opposite reason, that it must
 * never be written at all.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useSomaStore } from "@/stores/soma"
import { useSettingsStore } from "@/settings/store"

import {
  clampPeekAlpha,
  clampPeekWidth,
  closePeekForItem,
  escapeClosesPeek,
  peekAlphaOptions,
  usePeekStore,
  PEEK_DEFAULT_WIDTH,
  PEEK_MAX_WIDTH,
  PEEK_MIN_WIDTH,
} from "./store"

const NOTE = { kind: "note", id: "n1" } as const

/** Reloads the module with whatever is in storage, which is what a relaunch does. */
async function reload(): Promise<typeof import("./store")> {
  vi.resetModules()
  return import("./store")
}

const initial = usePeekStore.getState()

beforeEach(() => {
  localStorage.clear()
  usePeekStore.setState({ ...initial, item: null, nonce: 0 })
  useSomaStore.setState({ dockOpen: false })
  useSettingsStore.setState({ values: { "App.DeveloperMode": true, "AI.EnableAssistant": true } })
})

afterEach(() => {
  vi.resetModules()
})

describe("peek store shape", () => {
  it("clamps a width to the range the panel reads well at", () => {
    expect(clampPeekWidth(10)).toBe(PEEK_MIN_WIDTH)
    expect(clampPeekWidth(5000)).toBe(PEEK_MAX_WIDTH)
    expect(clampPeekWidth(520.4)).toBe(520)
  })

  it("snaps a background opacity to the steps the menu offers", () => {
    expect(clampPeekAlpha(0)).toBe(40)
    expect(clampPeekAlpha(1000)).toBe(100)
    expect(clampPeekAlpha(63)).toBe(60)
    expect(peekAlphaOptions()).toEqual([100, 90, 80, 70, 60, 50, 40])
  })

  it("writes width, placement, side, pin, collapse and background to storage", () => {
    const store = usePeekStore.getState()
    store.setWidth(640)
    store.setSide("left")
    store.setPlacement("docked")
    store.togglePinned()
    store.toggleCollapsed()
    store.setAlpha(70)

    expect(localStorage.getItem("mnemo.peek.width")).toBe("640")
    expect(localStorage.getItem("mnemo.peek.side")).toBe("left")
    expect(localStorage.getItem("mnemo.peek.placement")).toBe("docked")
    expect(localStorage.getItem("mnemo.peek.pinned")).toBe("true")
    expect(localStorage.getItem("mnemo.peek.collapsed")).toBe("true")
    expect(localStorage.getItem("mnemo.peek.alpha")).toBe("70")
  })

  it("reads the stored shape back on the next launch", async () => {
    localStorage.setItem("mnemo.peek.width", "700")
    localStorage.setItem("mnemo.peek.placement", "docked")
    localStorage.setItem("mnemo.peek.side", "left")
    localStorage.setItem("mnemo.peek.pinned", "true")
    localStorage.setItem("mnemo.peek.alpha", "50")

    const fresh = await reload()
    const state = fresh.usePeekStore.getState()

    expect(state.width).toBe(700)
    expect(state.placement).toBe("docked")
    expect(state.side).toBe("left")
    expect(state.pinned).toBe(true)
    expect(state.alpha).toBe(50)
  })

  it("clamps and falls back on a stored value that makes no sense", async () => {
    localStorage.setItem("mnemo.peek.width", "99999")
    localStorage.setItem("mnemo.peek.alpha", "not a number")
    localStorage.setItem("mnemo.peek.placement", "sideways")
    localStorage.setItem("mnemo.peek.side", "up")

    const fresh = await reload()
    const state = fresh.usePeekStore.getState()

    expect(state.width).toBe(PEEK_MAX_WIDTH)
    expect(state.alpha).toBe(100)
    expect(state.placement).toBe("overlay")
    expect(state.side).toBe("right")
  })

  it("starts from the defaults with nothing stored", async () => {
    const fresh = await reload()
    const state = fresh.usePeekStore.getState()

    expect(state.width).toBe(PEEK_DEFAULT_WIDTH)
    expect(state.placement).toBe("overlay")
    expect(state.pinned).toBe(false)
    expect(state.collapsed).toBe(false)
    expect(state.alpha).toBe(100)
  })

  it("never persists what is being shown", () => {
    usePeekStore.getState().openPeek(NOTE)
    expect(Object.keys(localStorage).some((key) => key.startsWith("mnemo.peek."))).toBe(false)
  })
})

describe("peek store behaviour", () => {
  it("expands a collapsed peek when something new is opened in it", () => {
    usePeekStore.getState().toggleCollapsed()
    usePeekStore.getState().openPeek(NOTE)
    expect(usePeekStore.getState().collapsed).toBe(false)
  })

  it("expands when the placement changes, so docking never takes a column to show a rail", () => {
    usePeekStore.getState().toggleCollapsed()
    usePeekStore.getState().setPlacement("docked")
    expect(usePeekStore.getState().collapsed).toBe(false)
    expect(localStorage.getItem("mnemo.peek.collapsed")).toBe("false")
  })

  it("bumps the refresh nonce only while something is open", () => {
    usePeekStore.getState().refreshPeek()
    expect(usePeekStore.getState().nonce).toBe(0)

    usePeekStore.getState().openPeek(NOTE)
    const opened = usePeekStore.getState().nonce
    usePeekStore.getState().refreshPeek()
    expect(usePeekStore.getState().nonce).toBe(opened + 1)
  })

  it("lets Escape close only an unpinned overlay", () => {
    usePeekStore.getState().openPeek(NOTE)
    expect(escapeClosesPeek()).toBe(true)

    usePeekStore.getState().togglePinned()
    expect(escapeClosesPeek()).toBe(false)

    usePeekStore.getState().togglePinned()
    usePeekStore.getState().setPlacement("docked")
    expect(escapeClosesPeek()).toBe(false)
  })

  it("drops the current item only when that item is the one that went away", () => {
    usePeekStore.getState().openPeek(NOTE)

    closePeekForItem("note", "somebody else")
    expect(usePeekStore.getState().item).toEqual(NOTE)

    closePeekForItem("card", NOTE.id)
    expect(usePeekStore.getState().item).toEqual(NOTE)

    closePeekForItem("note", NOTE.id)
    expect(usePeekStore.getState().item).toBeNull()
  })
})

describe("Soma in the peek and Soma in the dock", () => {
  it("closes the dock when Soma opens in the peek", () => {
    useSomaStore.getState().setDockOpen(true)
    usePeekStore.getState().openPeek({ kind: "soma" })

    expect(useSomaStore.getState().dockOpen).toBe(false)
    expect(usePeekStore.getState().item).toEqual({ kind: "soma" })
  })

  it("closes a Soma peek when the dock opens", () => {
    usePeekStore.getState().openPeek({ kind: "soma" })
    useSomaStore.getState().setDockOpen(true)

    expect(usePeekStore.getState().item).toBeNull()
  })

  it("leaves a note peek alone when the dock opens", () => {
    usePeekStore.getState().openPeek(NOTE)
    useSomaStore.getState().setDockOpen(true)

    expect(usePeekStore.getState().item).toEqual(NOTE)
    expect(useSomaStore.getState().dockOpen).toBe(true)
  })

  it("refuses to open Soma at all while the assistant is off", () => {
    useSettingsStore.setState({ values: { "App.DeveloperMode": true, "AI.EnableAssistant": false } })
    usePeekStore.getState().openPeek({ kind: "soma" })

    expect(usePeekStore.getState().item).toBeNull()
  })

  it("refuses to open Soma with developer mode off, whatever the assistant switch says", () => {
    useSettingsStore.setState({ values: { "App.DeveloperMode": false, "AI.EnableAssistant": true } })
    usePeekStore.getState().openPeek({ kind: "soma" })

    expect(usePeekStore.getState().item).toBeNull()
  })
})
