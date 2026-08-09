import { useEffect } from "react"

import { useRouteNormalization } from "@/app/router"
import { AppShell } from "@/components/shell/AppShell"
import { DialogHost } from "@/components/shell/DialogHost"
import { CommandPalette } from "@/components/shell/palette/CommandPalette"
import { ToastHost } from "@/components/shell/ToastHost"
import { CardEditorOverlay } from "@/flashcards/editor/CardEditorOverlay"
import { ReviewSettingsOverlay } from "@/flashcards/presets/ReviewSettingsOverlay"
import { TransferOverlay } from "@/flashcards/transfer/TransferOverlay"
import { KeybindManagerOverlay } from "@/keybinds/manager/KeybindManagerOverlay"
import { registerKeybindAction } from "@/keybinds/registry"
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

  // global.assistant toggles the dock rather than navigating: the point of Soma is
  // that it comes to the work, and a shortcut that throws away the page you were
  // on is the opposite of that. The rail still navigates to the full surface.
  useEffect(() => registerKeybindAction("global.assistant", () => {
    useSomaStore.getState().toggleDock()
  }), [])

  useEffect(() => registerKeybindAction("global.search", () => {
    usePaletteStore.getState().toggle()
  }), [])

  return (
    <>
      <AppShell />
      <CommandPalette />
      <ToastHost />
      <DialogHost />
      <KeybindManagerOverlay />
      <CardEditorOverlay />
      <ReviewSettingsOverlay />
      <TransferOverlay />
      <OnboardingWizard />
    </>
  )
}

export default App
