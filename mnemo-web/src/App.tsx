import { useEffect } from "react"

import { useRouteNormalization } from "@/app/router"
import { AppShell } from "@/components/shell/AppShell"
import { DialogHost } from "@/components/shell/DialogHost"
import { ToastHost } from "@/components/shell/ToastHost"
import { KeybindManagerOverlay } from "@/keybinds/manager/KeybindManagerOverlay"
import { registerKeybindAction } from "@/keybinds/registry"
import { OnboardingWizard } from "@/onboarding/OnboardingWizard"
import { dialog } from "@/stores/dialog"
import { toast } from "@/stores/toast"

// Dev-only console handles for exercising the toast/dialog systems by hand
// (window.mnemo.toast.success("hi"), await window.mnemo.dialog.confirm({...})).
if (import.meta.env.DEV) {
  ;(globalThis as unknown as { mnemo?: unknown }).mnemo = { toast, dialog }
}

function App() {
  useRouteNormalization()

  // Wire the global actions that have a target today to their behavior. The Atlas
  // shortcut (global.assistant, Primary+J) navigates to the chat route; search and
  // quick-actions register when their overlays land.
  useEffect(() => registerKeybindAction("global.assistant", () => {
    window.location.hash = "#/chat"
  }), [])

  return (
    <>
      <AppShell />
      <ToastHost />
      <DialogHost />
      <KeybindManagerOverlay />
      <OnboardingWizard />
    </>
  )
}

export default App
