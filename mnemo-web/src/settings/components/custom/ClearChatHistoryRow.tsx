import { useState } from "react"

import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"
import { dialog } from "@/stores/dialog"

import { clearChatHistory } from "../../api"
import { SettingRowShell } from "../SettingRowShell"

/** Deletes every saved conversation, behind a destructive confirmation. */
export function ClearChatHistoryRow({
  title,
  description,
  divider,
}: {
  title: string
  description?: string
  divider: boolean
}) {
  const t = useT()
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function clear() {
    const confirmed = await dialog.confirm({
      title: t("Settings", "ClearChatHistoryConfirmTitle"),
      message: t("Settings", "ClearChatHistoryConfirmMessage"),
      confirmLabel: t("Settings", "ClearAllChatHistory"),
      cancelLabel: t("Common", "Cancel"),
      destructive: true,
    })
    if (!confirmed) return

    setBusy(true)
    try {
      await clearChatHistory()
      setStatus(t("Settings", "ClearChatHistoryDone"))
    } catch {
      setStatus(t("Common", "Error"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingRowShell title={title} description={status ?? description} divider={divider}>
      <Button variant="danger" size="sm" disabled={busy} onClick={() => void clear()}>
        {t("Settings", "ClearAllChatHistory")}
      </Button>
    </SettingRowShell>
  )
}
