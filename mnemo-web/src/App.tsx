import { useRouteNormalization } from "@/app/router"
import { AppShell } from "@/components/shell/AppShell"

function App() {
  useRouteNormalization()
  return <AppShell />
}

export default App
