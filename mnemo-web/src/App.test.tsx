// @vitest-environment jsdom

/**
 * The shell's launch effects, with every surface and side effect stubbed. Pinned here because the
 * restore outcome is read nowhere else after a restart: a launch that forgot to ask would leave a
 * rolled back restore silent.
 */

import { act, StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

const launch = vi.hoisted(() => ({ announcePendingRestoreOutcome: vi.fn() }))
const none = () => null
const noop = () => {}
const uninstall = () => noop

vi.mock("@/settings/restore-outcome", () => launch)
vi.mock("@/app/BetaNoticeHost", () => ({ BetaNoticeHost: none }))
vi.mock("@/app/client-info", () => ({ reportClientInfo: noop }))
vi.mock("@/app/exit-confirm", () => ({ installExitConfirm: uninstall }))
vi.mock("@/app/legacy-install-warning", () => ({ checkLegacyInstallWarning: noop }))
vi.mock("@/app/prefetch", () => ({ startRoutePrefetch: uninstall }))
vi.mock("@/app/router", () => ({ useRouteNormalization: noop }))
vi.mock("@/app/unload-backstop", () => ({ installUnloadBackstop: uninstall }))
vi.mock("@/components/brand/useBrandIconSync", () => ({ useBrandIconSync: noop }))
vi.mock("@/components/shell/AppShell", () => ({ AppShell: none }))
vi.mock("@/components/shell/chrome/useDragRegions", () => ({ useDragRegions: noop }))
vi.mock("@/components/shell/DialogHost", () => ({ DialogHost: none }))
vi.mock("@/components/shell/palette/CommandPalette", () => ({ CommandPalette: none }))
vi.mock("@/components/ui/image-editor/ImageEditorHost", () => ({ ImageEditorHost: none }))
vi.mock("@/components/ui/tooltip", () => ({ TooltipHost: none }))
vi.mock("@/flashcards/cardtypes/CardTypeOverlay", () => ({ CardTypeOverlay: none }))
vi.mock("@/flashcards/facts/FactEditorOverlay", () => ({ FactEditorOverlay: none }))
vi.mock("@/flashcards/presets/ReviewSettingsOverlay", () => ({ ReviewSettingsOverlay: none }))
vi.mock("@/flashcards/transfer/TransferOverlay", () => ({ TransferOverlay: none }))
vi.mock("@/keybinds/registry", () => ({ registerKeybindAction: uninstall }))
vi.mock("@/lib/native-drop", () => ({ installNativeDropGuard: uninstall }))
vi.mock("@/lib/native-keys", () => ({ installNativeKeyGuard: uninstall }))
vi.mock("@/lib/native-menu", () => ({ installContextMenuGuard: uninstall }))
vi.mock("@/onboarding/OnboardingWizard", () => ({ OnboardingWizard: none }))
vi.mock("@/stores/dialog", () => ({ dialog: {} }))
vi.mock("@/stores/palette", () => ({ usePaletteStore: { getState: () => ({ toggle: noop }) } }))
vi.mock("@/stores/soma", () => ({ useSomaStore: { getState: () => ({ toggleDock: noop }) } }))
vi.mock("@/stores/toast", () => ({ toast: {} }))
vi.mock("@/updates/store", () => ({ startUpdateWatch: uninstall }))

const { default: App } = await import("./App")

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  vi.clearAllMocks()
})

describe("App", () => {
  it("asks for a restore's outcome when it starts", () => {
    const container = document.createElement("div")
    const root = createRoot(container)

    act(() => root.render(<StrictMode><App /></StrictMode>))

    expect(launch.announcePendingRestoreOutcome).toHaveBeenCalled()
    act(() => root.unmount())
  })
})
