/**
 * The host answers shouldWarn at most once ever, so this only has to cover: a true answer
 * shows the sticky warning toast with the right copy, a false answer shows nothing, and a
 * failed request is swallowed rather than left unhandled.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useI18nStore } from "@/i18n/store"
import { useToastStore } from "@/stores/toast"

const client = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock("@/api/client", () => client)

const { checkLegacyInstallWarning } = await import("./legacy-install-warning")

beforeEach(() => {
  useToastStore.setState({ toasts: [], history: [] })
  useI18nStore.setState({
    bundle: {
      App: {
        LegacyInstallWarningTitle: "An older Mnemo is still installed",
        LegacyInstallWarningBody: "Uninstall the older Mnemo to keep using this one safely.",
      },
    },
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("checkLegacyInstallWarning", () => {
  it("shows a sticky warning toast when the host says to", async () => {
    client.apiFetch.mockResolvedValue({ shouldWarn: true })

    checkLegacyInstallWarning()
    await vi.waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1))

    const [toast] = useToastStore.getState().toasts
    expect(toast.type).toBe("warning")
    expect(toast.title).toBe("An older Mnemo is still installed")
    expect(toast.description).toBe("Uninstall the older Mnemo to keep using this one safely.")
    expect(toast.durationMs).toBe(0)
    expect(client.apiFetch).toHaveBeenCalledWith("/app/legacy-install-check", { method: "POST" })
  })

  it("shows nothing when the host says not to warn", async () => {
    client.apiFetch.mockResolvedValue({ shouldWarn: false })

    checkLegacyInstallWarning()
    await vi.waitFor(() => expect(client.apiFetch).toHaveBeenCalled())

    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it("does not throw when the request fails", async () => {
    client.apiFetch.mockRejectedValue(new Error("offline"))

    expect(() => checkLegacyInstallWarning()).not.toThrow()
    await vi.waitFor(() => expect(client.apiFetch).toHaveBeenCalled())

    expect(useToastStore.getState().toasts).toHaveLength(0)
  })
})
