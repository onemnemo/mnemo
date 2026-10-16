// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ExportFormatList, type ExportFormatOption } from "./ExportFormatList"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const markdown: ExportFormatOption = { formatId: "md", label: "Markdown", caption: "Portable", extension: ".md" }
const archive: ExportFormatOption = { formatId: "mnemo", label: "Mnemo", caption: "", extension: ".mnemo" }

let container: HTMLElement
let root: Root
const onSelect = vi.fn()

beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  onSelect.mockClear()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(formats: ExportFormatOption[], selected: string | null = null) {
  act(() =>
    root.render(
      <ExportFormatList
        groupLabel="Format"
        contents="3 notes"
        formats={formats}
        selected={selected}
        busy={false}
        unavailable="No format"
        onSelect={onSelect}
      />,
    ),
  )
}

describe("ExportFormatList", () => {
  it("disables the radios while busy", () => {
    act(() =>
      root.render(
        <ExportFormatList groupLabel="Format" contents="" formats={[markdown, archive]} selected="md" busy unavailable="" onSelect={onSelect} />,
      ),
    )
    const radios = [...container.querySelectorAll<HTMLInputElement>("input")]
    expect(radios.every((radio) => radio.disabled)).toBe(true)
  })

  it("says so when the host offers no format", () => {
    render([])
    expect(container.textContent).toContain("No format")
    expect(container.querySelector("input")).toBeNull()
  })

  it("shows a single format as a row without a radio", () => {
    render([markdown])
    expect(container.textContent).toContain("Markdown")
    expect(container.textContent).toContain(".md")
    expect(container.querySelector("input")).toBeNull()
  })

  it("lists several formats as radios and reports the one picked", () => {
    render([markdown, archive], "md")
    const radios = [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
    expect(container.querySelector('[role="radiogroup"]')?.getAttribute("aria-label")).toBe("Format")
    expect(radios.map((radio) => radio.checked)).toEqual([true, false])

    act(() => radios[1].click())
    expect(onSelect).toHaveBeenCalledWith("mnemo")
  })

  it("leaves out the caption line when a format has none", () => {
    render([markdown, archive])
    expect(container.textContent).toContain("Portable")
    const labels = [...container.querySelectorAll("label")].map((label) => label.textContent)
    expect(labels[0]).toContain("Portable")
    expect(labels[1]).toBe("Mnemo.mnemo")
  })
})
