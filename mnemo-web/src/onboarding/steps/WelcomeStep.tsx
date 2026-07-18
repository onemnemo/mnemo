import { useQuery } from "@tanstack/react-query"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { fetchAppInfo } from "@/settings/api"
import { formatVersion } from "@/settings/version"

/** The opening step: the mark, and the build the user is about to run. */
export function WelcomeStep() {
  const t = useT()
  const { data } = useQuery({ queryKey: ["app", "info"], queryFn: fetchAppInfo })

  return (
    <div className="flex flex-col items-center gap-4 py-6">
      <AppIcon name="branding/logo-full" size={120} preserveColors className="h-auto" />
      <p className="text-caption text-text-faded">
        {t("Onboarding", "VersionFormat", { 0: formatVersion(data?.version) })}
      </p>
    </div>
  )
}
