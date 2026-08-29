import { useEffect } from "react"

import { reportClientInfo } from "@/app/client-info"
import { installExitConfirm } from "@/app/exit-confirm"
import { checkLegacyInstallWarning } from "@/app/legacy-install-warning"
import { startRoutePrefetch } from "@/app/prefetch"
import { useRouteNormalization } from "@/app/router"
import { installUnloadBackstop } from "@/app/unload-backstop"
import { AppShell } from "@/components/shell/AppShell"
import { useDragRegions } from "@/components/shell/chrome/useDragRegions"
import { DialogHost } from "@/components/shell/DialogHost"
import { CommandPalette } from "@/components/shell/palette/CommandPalette"
import { TooltipHost } from "@/components/ui/tooltip"
import { CardTypeOverlay } from "@/flashcards/cardtypes/CardTypeOverlay"
import { FactEditorOverlay } from "@/flashcards/facts/FactEditorOverlay"
import { ReviewSettingsOverlay } from "@/flashcards/presets/ReviewSettingsOverlay"
import { TransferOverlay } from "@/flashcards/transfer/TransferOverlay"
import { registerKeybindAction } from "@/keybinds/registry"
import { installNativeDropGuard } from "@/lib/native-drop"
import { installNativeKeyGuard } from "@/lib/native-keys"
import { installContextMenuGuard } from "@/lib/native-menu"
import { OnboardingWizard } from "@/onboarding/OnboardingWizard"
import { dialog } from "@/stores/dialog"
import { usePaletteStore } from "@/stores/palette"
import { useSomaStore } from "@/stores/soma"
import { toast } from "@/stores/toast"
import { startUpdateWatch } from "@/updates/store"

// Dev-only console handles for exercising the toast/dialog systems by hand
// (window.mnemo.toast.success("hi"), await window.mnemo.dialog.confirm({...})).
if (import.meta.env.DEV) {
  ;(globalThis as unknown as { mnemo?: unknown }).mnemo = { toast, dialog }
}

function App() {
  useRouteNormalization()

  // At the root rather than in a bar component, because it collects every drag
  // surface in the document, the onboarding screen's included.
  useDragRegions()

  useEffect(() => installContextMenuGuard(), [])

  useEffect(() => installNativeKeyGuard(), [])

  useEffect(() => installNativeDropGuard(), [])

  useEffect(() => installExitConfirm(), [])

  useEffect(() => installUnloadBackstop(), [])

  // Here rather than in the settings page, because the launch check has to run whether
  // or not anyone opens settings, and the download it may start has to keep reporting
  // once they navigate away from it.
  useEffect(() => startUpdateWatch(), [])

  // Runs on every boot; the host answers true at most once ever, so this never repeats
  // the warning once it has been shown.
  useEffect(() => checkLegacyInstallWarning(), [])

  // So a report of a blank or broken window has an engine and a user agent in the
  // host log to match against.
  useEffect(() => reportClientInfo(), [])

  // Mounted rather than called at import time on purpose: the code the pages need is worth
  // fetching with time the window is not otherwise using, and never at the expense of the
  // paint. Cancelled on unmount, so it cannot outlive the shell that wanted it.
  useEffect(() => startRoutePrefetch(), [])

  // global.assistant toggles the dock rather than navigating: the point of Soma is
  // that it comes to the work, and a shortcut that throws away the page you were
  // on is the opposite of that. The rail still navigates to the full surface.
  useEffect(() => registerKeybindAction("global.assistant", () => {
    useSomaStore.getState().toggleDock()
  }), [])

  useEffect(() => registerKeybindAction("global.search", () => {
    usePaletteStore.getState().toggle()
  }), [])

  // The quick-actions catalogue is a settings page, not a modal, so this keybind navigates
  // there.
  useEffect(() => registerKeybindAction("global.quick-actions", () => {
    window.location.hash = "#/settings/Keyboard"
  }), [])

  return (
    <>
      <AppShell />
      <CommandPalette />
      <DialogHost />
      <FactEditorOverlay />
      <CardTypeOverlay />
      <ReviewSettingsOverlay />
      <TransferOverlay />
      <OnboardingWizard />
      {/* Last, so its portal is the topmost thing in the body and a hint is never drawn
          under the overlay whose button raised it. */}
      <TooltipHost />
    </>
  )
}

export default App
