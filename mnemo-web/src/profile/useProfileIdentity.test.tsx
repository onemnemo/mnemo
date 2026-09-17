// @vitest-environment jsdom

import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useSettingsStore } from "@/settings/store"

import { useProfileIdentity } from "./useProfileIdentity"

vi.mock("@/api/asset-blob", () => ({ useAssetObjectUrl: () => null }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let name = "not rendered"

function Probe() {
  name = useProfileIdentity().name
  return null
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  useSettingsStore.setState({ values: {}, secrets: {}, loaded: true, failed: false })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("useProfileIdentity", () => {
  it("leaves a missing display name blank for the translated callers to label", () => {
    act(() => root.render(<StrictMode><Probe /></StrictMode>))

    expect(name).toBe("")
  })
})
