import { useRouteNormalization } from "@/app/router"
import { AppShell } from "@/components/shell/AppShell"
import { DialogHost } from "@/components/shell/DialogHost"
import { ToastHost } from "@/components/shell/ToastHost"
import { dialog } from "@/stores/dialog"
import { toast } from "@/stores/toast"

// Dev-only console handles for exercising the toast/dialog systems by hand
// (window.mnemo.toast.success("hi"), await window.mnemo.dialog.confirm({...})).
if (import.meta.env.DEV) {
  ;(globalThis as unknown as { mnemo?: unknown }).mnemo = { toast, dialog }
}

function App() {
  useRouteNormalization()
  return (
    <>
      <AppShell />
      <ToastHost />
      <DialogHost />
    </>
  )
}

export default App
