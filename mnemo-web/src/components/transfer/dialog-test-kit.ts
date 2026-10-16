import { act } from "react"
import { expect } from "vitest"

export async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

export async function chooseFiles(...names: string[]): Promise<void> {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement | null
  expect(input).not.toBeNull()
  const files = names.map((name) => new File([new Uint8Array(1)], name))
  Object.defineProperty(input, "files", { value: files, configurable: true })
  input?.dispatchEvent(new Event("change", { bubbles: true }))
  await flush()
}

/** Found by position: its spinner and shortcut hint add text. */
export function confirmButton(): HTMLButtonElement {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
  const cancel = buttons.findIndex((button) => button.textContent?.trim() === "Cancel")
  expect(cancel).toBeGreaterThanOrEqual(0)
  return buttons[cancel + 1]
}

export function conflictTrigger(): HTMLElement | null {
  return document.querySelector('[role="dialog"] [data-transfer-conflict]')
}

export function pickPolicy(label: string): void {
  const trigger = conflictTrigger()
  expect(trigger).not.toBeNull()
  act(() => {
    trigger!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  })
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find((row) =>
    row.textContent?.startsWith(label),
  )
  expect(item).toBeDefined()
  act(() => item!.click())
}
