import { useState } from "react"

import { type AiKeyValidationResult, validateAiKey } from "@/api/ai"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"
import type { TranslateFn } from "@/i18n/types"

import { SettingRowShell } from "../SettingRowShell"

/**
 * Tests the saved OpenRouter key and reports remaining credits.
 *
 * No key is sent: secrets are write-only over the API, so the server tests the one it
 * already holds. That also means this checks what the assistant will actually use,
 * not what happens to be typed in the field above.
 */
export function TestConnectionRow({
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

  async function test() {
    setBusy(true)
    setStatus(null)
    try {
      setStatus(describeValidation(await validateAiKey(), t))
    } catch {
      setStatus(t("Settings", "TestConnectionFailed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingRowShell
      title={title}
      description={status ?? description}
      divider={divider}
    >
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void test()}>
        {t("Settings", "TestNow")}
      </Button>
    </SettingRowShell>
  )
}

/** Mirrors SettingsViewModel.FormatKeyValidation. */
function describeValidation(result: AiKeyValidationResult, t: TranslateFn): string {
  if (result.isValid) {
    if (result.creditsLimit != null)
      return t("Settings", "TestConnectionOkLeftFormat", {
        0: formatCredits(result.creditsLimit - (result.creditsUsed ?? 0)),
      })

    if (result.creditsUsed != null)
      return t("Settings", "TestConnectionOkUsedFormat", { 0: formatCredits(result.creditsUsed) })

    return t("Settings", "TestConnectionOk")
  }

  switch (result.failureKind) {
    case "invalid_api_key":
      return t("Settings", "TestConnectionInvalidKey")
    case "network":
    case "timeout":
      return t("Settings", "TestConnectionOffline")
    case "rate_limited":
      return t("Settings", "TestConnectionRateLimited")
    default:
      return t("Settings", "TestConnectionFailed")
  }
}

function formatCredits(amount: number): string {
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
