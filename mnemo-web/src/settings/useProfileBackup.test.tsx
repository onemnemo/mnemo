// @vitest-environment jsdom

import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const command = vi.hoisted(() => ({ createProfileBackup: vi.fn() }))
vi.mock("./backup-export", () => command)
vi.mock("@/i18n/useT", () => ({ useT: () => (_ns: string, key: string) => key }))

import { useProfileBackup } from "./useProfileBackup"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Probe() {
  const backup = useProfileBackup()
  return (
    <button type="button" disabled={backup.busy} onClick={backup.start}>
      {backup.label}
    </button>
  )
}

/** A backup the test decides when to finish. */
function pending(): { promise: Promise<void>; finish: () => void } {
  let finish!: () => void
  const promise = new Promise<void>((resolve) => {
    finish = resolve
  })
  return { promise, finish }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

function button(): HTMLButtonElement {
  return container.querySelector("button")!
}

describe("useProfileBackup", () => {
  it("is busy, with the running label, until the backup settles", async () => {
    const backup = pending()
    command.createProfileBackup.mockReturnValue(backup.promise)
    await act(async () => root.render(<StrictMode><Probe /></StrictMode>))
    expect(button().textContent).toBe("BackUp")
    expect(button().disabled).toBe(false)

    await act(async () => {
      button().click()
    })
    expect(button().textContent).toBe("BackingUp")
    expect(button().disabled).toBe(true)

    await act(async () => {
      backup.finish()
      await backup.promise
    })
    expect(button().textContent).toBe("BackUp")
    expect(button().disabled).toBe(false)
  })

  it("starts one backup however many presses land before the button is disabled", async () => {
    const backup = pending()
    command.createProfileBackup.mockReturnValue(backup.promise)
    await act(async () => root.render(<StrictMode><Probe /></StrictMode>))

    await act(async () => {
      button().click()
      button().click()
      button().click()
    })
    expect(command.createProfileBackup).toHaveBeenCalledOnce()

    await act(async () => {
      backup.finish()
      await backup.promise
    })
    await act(async () => {
      button().click()
    })
    expect(command.createProfileBackup).toHaveBeenCalledTimes(2)
  })
})
