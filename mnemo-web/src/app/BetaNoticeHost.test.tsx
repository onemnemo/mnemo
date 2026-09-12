// @vitest-environment jsdom

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DialogHost } from "@/components/shell/DialogHost"
import { useSettingsStore } from "@/settings/store"
import { useDialogStore } from "@/stores/dialog"
import { useUpdateStore } from "@/updates/store"
import type { UpdateStatus } from "@/updates/types"

const mocks = vi.hoisted(() => ({
  createProfileBackup: vi.fn(),
  fetchNav: vi.fn(),
  openExternally: vi.fn(),
  putSettingValue: vi.fn(),
}))

vi.mock("@/components/icon/AppIcon", () => ({ AppIcon: () => null }))
vi.mock("@/i18n/useT", () => ({
  useT: () => (_ns: string, key: string, params?: Record<string, string | number>) =>
    params?.version === undefined ? key : `${key}:${String(params.version)}`,
}))
vi.mock("@/lib/external", () => ({ openExternally: mocks.openExternally }))
vi.mock("@/nav/api", () => ({ fetchNav: mocks.fetchNav }))
vi.mock("@/settings/api", () => ({ fetchSettingValues: vi.fn(), putSettingValue: mocks.putSettingValue }))
vi.mock("@/settings/backup-export", () => ({ createProfileBackup: mocks.createProfileBackup }))

import { BETA_NOTICE_SEEN_VERSION_KEY } from "./beta-notice"
import { BetaNoticeHost } from "./BetaNoticeHost"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const VERSION = "0.8.0-beta.2+3f9c1a2"
const ISSUE_URL = "https://github.com/onemnemo/mnemo/issues/new"

function status(patch: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    stage: "Idle",
    version: VERSION,
    // Following Stable while running a beta: the running build is what counts.
    channel: "stable",
    runningChannel: "beta",
    supportsInAppApply: true,
    awaitingChannelCatchUp: false,
    lastCheckedUtc: null,
    availableVersion: null,
    releaseNotesMarkdown: null,
    downloadProgress: 0,
    shouldPrompt: false,
    skipped: false,
    error: null,
    ...patch,
  }
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
  useSettingsStore.setState({ values: { "Onboarding.Completed": true }, secrets: {}, loaded: true, failed: false })
  useUpdateStore.setState({ status: status(), busy: false })
  useDialogStore.setState({ queue: [] })
  mocks.putSettingValue.mockResolvedValue(undefined)
  mocks.fetchNav.mockResolvedValue([])
  mocks.createProfileBackup.mockResolvedValue(undefined)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

async function render(ui: ReactNode = <BetaNoticeHost />) {
  await act(async () => {
    root.render(ui)
  })
}

function notice(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"][aria-label="BetaNoticeTitle"]')
}

function wrapper(): HTMLElement {
  return notice()!.parentElement!
}

function button(label: string): HTMLButtonElement {
  const found = [...notice()!.querySelectorAll("button")].find((candidate) => candidate.textContent === label)
  expect(found, `no button reads ${label}`).toBeDefined()
  return found!
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click()
    await Promise.resolve()
  })
}

function press(key: string, shiftKey = false) {
  act(() => {
    ;(document.activeElement ?? document).dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true }))
  })
}

function pushExitConfirm(): void {
  useDialogStore.setState({
    queue: [
      {
        kind: "confirm",
        id: "exit-1",
        title: "Quit Mnemo?",
        confirmLabel: "Quit",
        cancelLabel: "Cancel",
        destructive: false,
        resolve: () => {},
      },
    ],
  })
}

describe("when the beta notice opens", () => {
  it("opens once the snapshot and the updater agree, showing the version without its build metadata", async () => {
    await render()

    expect(notice()).not.toBeNull()
    expect(notice()!.textContent).toContain("BetaNoticeBadge:0.8.0-beta.2")
    expect(notice()!.textContent).not.toContain("3f9c1a2")
  })

  it("waits behind first-time setup and opens as it exits", async () => {
    useSettingsStore.setState({ values: {} })
    await render()
    expect(notice()).toBeNull()

    act(() => useSettingsStore.setState({ values: { "Onboarding.Completed": true } }))
    expect(notice()).not.toBeNull()
  })

  it("stays closed on a stable build, and after this version was acknowledged", async () => {
    useUpdateStore.setState({ status: status({ runningChannel: "stable", channel: "beta" }) })
    await render()
    expect(notice()).toBeNull()

    useUpdateStore.setState({ status: status() })
    act(() =>
      useSettingsStore.setState({ values: { "Onboarding.Completed": true, [BETA_NOTICE_SEEN_VERSION_KEY]: VERSION } }),
    )
    expect(notice()).toBeNull()
  })

  it("stays closed while the updater has not reported, or the snapshot failed to load", async () => {
    useUpdateStore.setState({ status: null })
    await render()
    expect(notice()).toBeNull()

    act(() => useUpdateStore.setState({ status: status() }))
    expect(notice()).not.toBeNull()

    act(() => useSettingsStore.setState({ values: {}, failed: true }))
    expect(notice()).toBeNull()
  })
})

describe("answering the beta notice", () => {
  it("records the exact running version on Continue and closes", async () => {
    await render()

    await click(button("Continue"))

    expect(mocks.putSettingValue).toHaveBeenCalledWith(BETA_NOTICE_SEEN_VERSION_KEY, VERSION)
    expect(useSettingsStore.getState().values[BETA_NOTICE_SEEN_VERSION_KEY]).toBe(VERSION)
    expect(notice()).toBeNull()
  })

  it("acknowledges on Escape the same way", async () => {
    await render()

    press("Escape")

    expect(mocks.putSettingValue).toHaveBeenCalledWith(BETA_NOTICE_SEEN_VERSION_KEY, VERSION)
    expect(notice()).toBeNull()
  })

  it("neither closes nor acknowledges on a click on the wash", async () => {
    await render()
    const wash = wrapper().firstElementChild as HTMLElement

    await click(wash)

    expect(notice()).not.toBeNull()
    expect(mocks.putSettingValue).not.toHaveBeenCalled()
  })

  it("has no close button in its header", async () => {
    await render()

    expect(notice()!.querySelector("header button")).toBeNull()
  })

  it("closes even when the acknowledgement cannot be saved, and leaves the next launch to ask again", async () => {
    mocks.putSettingValue.mockRejectedValue(new Error("offline"))
    await render()

    await click(button("Continue"))
    expect(notice()).toBeNull()

    await vi.waitFor(() => expect(useSettingsStore.getState().values[BETA_NOTICE_SEEN_VERSION_KEY]).toBeUndefined())
    expect(notice()).toBeNull()
  })
})

describe("the beta notice and the keyboard", () => {
  it("starts on Continue and keeps Tab inside", async () => {
    await render()
    expect(document.activeElement).toBe(button("Continue"))

    const first = notice()!.querySelector("button")!
    act(() => button("Continue").focus())
    press("Tab")
    expect(document.activeElement).toBe(first)

    press("Tab", true)
    expect(document.activeElement).toBe(button("Continue"))
  })
})

describe("the beta notice under a queued dialog", () => {
  it("yields while a confirmation is up and returns once it settles", async () => {
    await render()
    expect(wrapper().getAttribute("aria-hidden")).toBeNull()

    act(() => pushExitConfirm())
    expect(wrapper().getAttribute("aria-hidden")).toBe("true")
    expect(wrapper().style.pointerEvents).toBe("none")
    expect(wrapper().style.opacity).toBe("0")

    press("Escape")
    expect(mocks.putSettingValue).not.toHaveBeenCalled()
    expect(notice()).not.toBeNull()

    act(() => useDialogStore.setState({ queue: [] }))
    expect(wrapper().getAttribute("aria-hidden")).toBeNull()
    expect(wrapper().style.pointerEvents).toBe("")
    expect(wrapper().style.opacity).toBe("")

    press("Escape")
    expect(mocks.putSettingValue).toHaveBeenCalledWith(BETA_NOTICE_SEEN_VERSION_KEY, VERSION)
  })

  it("exposes one active modal surface at a time with the dialog host mounted", async () => {
    await render(
      <>
        <BetaNoticeHost />
        <DialogHost />
      </>,
    )

    const answers: boolean[] = []
    await act(async () => {
      void useDialogStore
        .getState()
        .confirm({ title: "Quit Mnemo?", confirmLabel: "Quit", cancelLabel: "Cancel" })
        .then((value) => answers.push(value))
    })

    const active = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(
      (dialog) => !dialog.closest('[aria-hidden="true"]'),
    )
    expect(active).toHaveLength(1)
    expect(active[0].getAttribute("aria-label")).not.toBe("BetaNoticeTitle")

    const cancel = [...active[0].querySelectorAll("button")].find((candidate) => candidate.textContent === "Cancel")
    await click(cancel!)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(answers).toEqual([false])
    expect(notice()).not.toBeNull()
    expect(notice()!.closest('[aria-hidden="true"]')).toBeNull()
    expect(notice()!.contains(document.activeElement)).toBe(true)
    expect(mocks.putSettingValue).not.toHaveBeenCalled()
  })
})

describe("the beta notice's actions", () => {
  it("opens the issue form in the system browser and stays open", async () => {
    await render()

    await click(button("BetaNoticeReportBug"))

    expect(mocks.openExternally).toHaveBeenCalledWith(ISSUE_URL)
    expect(notice()).not.toBeNull()
  })

  it("runs the shared backup, holds Continue until it settles, and stays open afterwards", async () => {
    const backup = pending()
    mocks.createProfileBackup.mockReturnValue(backup.promise)
    await render()

    await click(button("BackUp"))
    expect(mocks.createProfileBackup).toHaveBeenCalledOnce()
    expect(button("BackingUp").disabled).toBe(true)
    expect(button("Continue").disabled).toBe(true)

    press("Escape")
    expect(mocks.putSettingValue).not.toHaveBeenCalled()
    expect(notice()).not.toBeNull()

    await act(async () => {
      backup.finish()
      await backup.promise
    })
    expect(notice()).not.toBeNull()
    expect(button("Continue").disabled).toBe(false)
    expect(mocks.putSettingValue).not.toHaveBeenCalled()

    await click(button("Continue"))
    expect(notice()).toBeNull()
  })
})
