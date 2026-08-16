import { useEffect } from "react"

import { installExitConfirm } from "@/app/exit-confirm"
import { useRouteNormalization } from "@/app/router"
import { AppShell } from "@/components/shell/AppShell"
import { DialogHost } from "@/components/shell/DialogHost"
import { CommandPalette } from "@/components/shell/palette/CommandPalette"
import { TooltipHost } from "@/components/ui/tooltip"
import { CardEditorOverlay } from "@/flashcards/editor/CardEditorOverlay"
import { ReviewSettingsOverlay } from "@/flashcards/presets/ReviewSettingsOverlay"
import { TransferOverlay } from "@/flashcards/transfer/TransferOverlay"
import { registerKeybindAction } from "@/keybinds/registry"
import { installContextMenuGuard } from "@/lib/native-menu"
import { OnboardingWizard } from "@/onboarding/OnboardingWizard"
import { dialog } from "@/stores/dialog"
import { usePaletteStore } from "@/stores/palette"
import { useSomaStore } from "@/stores/soma"
import { toast } from "@/stores/toast"

// Dev-only console handles for exercising the toast/dialog systems by hand
// (window.mnemo.toast.success("hi"), await window.mnemo.dialog.confirm({...})).
if (import.meta.env.DEV) {
  ;(globalThis as unknown as { mnemo?: unknown }).mnemo = { toast, dialog }
}

function App() {
  useRouteNormalization()

  useEffect(() => installContextMenuGuard(), [])

  useEffect(() => installExitConfirm(), [])

  // global.assistant toggles the dock rather than navigating: the point of Soma is
  // that it comes to the work, and a shortcut that throws away the page you were
  // on is the opposite of that. The rail still navigates to the full surface.
  useEffect(() => registerKeybindAction("global.assistant", () => {
    useSomaStore.getState().toggleDock()
  }), [])

  useEffect(() => registerKeybindAction("global.search", () => {
    usePaletteStore.getState().toggle()
  }), [])

  // What used to raise the quick-actions catalogue. It is a settings page now, so the
  // shortcut opens that page rather than a modal listing the same thing.
  useEffect(() => registerKeybindAction("global.quick-actions", () => {
    window.location.hash = "#/settings/Keyboard"
  }), [])

  return (
    <>
      <AppShell />
      <CommandPalette />
      <DialogHost />
      <CardEditorOverlay />
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
