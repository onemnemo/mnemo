// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it } from "vitest"

import { Tooltip } from "./Tooltip"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe("Tooltip", () => {
  it("marks its child with the label, a second line and a side", () => {
    const container = document.createElement("div")
    const root = createRoot(container)
    act(() =>
      root.render(
        <Tooltip label="Minimap: On" detail="Click for Auto" side="left">
          <button type="button" />
        </Tooltip>,
      ),
    )

    const button = container.querySelector("button")!
    expect(button.dataset.tooltip).toBe("Minimap: On")
    expect(button.dataset.tooltipDetail).toBe("Click for Auto")
    expect(button.dataset.tooltipSide).toBe("left")
    act(() => root.unmount())
  })
})
