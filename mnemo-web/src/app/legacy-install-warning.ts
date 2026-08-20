/**
 * Warns once, on the launch that finds it, when the pre-rewrite standalone Mnemo is still
 * installed alongside this app and sharing its data. Running both against the same profile is
 * unsafe; the host answers shouldWarn at most once ever, so this is safe to call on every boot.
 */

import { apiFetch } from "@/api/client"
import { useI18nStore } from "@/i18n/store"
import { createTranslate } from "@/i18n/translate"
import { toast } from "@/stores/toast"

interface LegacyInstallCheckDto {
  shouldWarn: boolean
}

export function checkLegacyInstallWarning(): void {
  void apiFetch<LegacyInstallCheckDto>("/app/legacy-install-check", { method: "POST" })
    .then((result) => {
      if (!result.shouldWarn) return

      const t = createTranslate(useI18nStore.getState().bundle)
      toast.warning(t("App", "LegacyInstallWarningTitle"), {
        description: t("App", "LegacyInstallWarningBody"),
        durationMs: 0,
      })
    })
    .catch((error: unknown) => {
      // Nothing to recover: the worst case is a warning that does not show this launch.
      console.error("[legacy-install] could not check for an old install", error)
    })
}
