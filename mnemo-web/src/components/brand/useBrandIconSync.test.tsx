// @vitest-environment jsdom
import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useSettingsStore } from "@/settings/store"

import { resetBrandIconSync, useBrandIconSync } from "./useBrandIconSync"

const api = vi.hoisted(() => ({
  host: { key: null as string | null, format: "ico" as string | null },
  calls: [] as string[],
}))

vi.mock("@/api/client", () => ({
  apiFetch: vi.fn(async () => ({ ...api.host })),
  apiSend: vi.fn(async (_path: string, init: RequestInit) => {
    if (init.method === "DELETE") {
      api.calls.push("DELETE")
      api.host.key = null
    } else {
      const key = (JSON.parse(init.body as string) as { key: string }).key
      api.calls.push(`PUT ${key}`)
      api.host.key = key
    }
  }),
}))

vi.mock("@/lib/brand/app-icon", async (original) => ({
  ...(await original<typeof import("@/lib/brand/app-icon")>()),
  renderIconFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
  lightAccentFill: () => "oklch(0.6 0.1 200)",
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Harness() {
  useBrandIconSync()
  return null
}

let root: Root | null = null

function mount() {
  root = createRoot(document.createElement("div"))
  act(() => root!.render(<StrictMode><Harness /></StrictMode>))
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)))
const choose = (values: Record<string, string>) => act(() => useSettingsStore.setState({ values }))

beforeEach(() => {
  api.host = { key: null, format: "ico" }
  api.calls = []
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  resetBrandIconSync()
  useSettingsStore.setState({ values: {} })
})

describe("useBrandIconSync", () => {
  it("sends nothing for the default logo on a host with no icon, even under StrictMode", async () => {
    mount()
    await settle()
    expect(api.calls).toEqual([])
  })

  it("sends one render for a chosen logo and skips it once the host holds it", async () => {
    useSettingsStore.setState({ values: { "Appearance.Logo": "forest" } })
    mount()
    await settle()
    act(() => root!.render(<StrictMode><Harness /></StrictMode>))
    await settle()
    expect(api.calls).toEqual(["PUT v1:forest"])
  })

  it("lands on the last of several quick changes", async () => {
    mount()
    choose({ "Appearance.Logo": "forest" })
    choose({ "Appearance.Logo": "nordic" })
    choose({ "Appearance.Logo": "sunset" })
    choose({ "Appearance.Logo": "harbour" })
    await settle()
    expect(api.host.key).toBe("v1:harbour")
  })

  it("reverts to the shipped icon when the default is picked again", async () => {
    api.host.key = "v1:forest"
    mount()
    await settle()
    expect(api.calls).toEqual(["DELETE"])
  })

  it("re-renders the accent logo when the accent changes, not otherwise", async () => {
    useSettingsStore.setState({ values: { "Appearance.Logo": "accent", "Appearance.Accent": "teal" } })
    mount()
    await settle()
    choose({ "Appearance.Logo": "accent", "Appearance.Accent": "rose" })
    await settle()
    expect(api.calls).toEqual(["PUT v1:accent:teal", "PUT v1:accent:rose"])
  })

  it("does nothing without a native window", async () => {
    api.host.format = null
    useSettingsStore.setState({ values: { "Appearance.Logo": "forest" } })
    mount()
    await settle()
    expect(api.calls).toEqual([])
  })
})
