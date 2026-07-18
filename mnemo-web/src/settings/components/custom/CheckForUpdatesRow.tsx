import { useQuery } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"

import { fetchAppInfo } from "../../api"
import { formatVersion } from "../../version"
import { SettingRowShell } from "../SettingRowShell"

/**
 * The current version, with the manual check still inert.
 *
 * Checking, downloading and applying updates is one state machine with the toast and
 * modal prompts around it, and it belongs to the update phase. Showing the version now
 * is free; wiring half of that machine here would not be.
 */
export function CheckForUpdatesRow({ title, divider }: { title: string; divider: boolean }) {
  const t = useT()
  const { data } = useQuery({ queryKey: ["app", "info"], queryFn: fetchAppInfo })

  return (
    <SettingRowShell
      title={title}
      description={t("Settings", "CurrentVersionLabelFormat", { 0: formatVersion(data?.version) })}
      divider={divider}
    >
      <Button variant="outline" size="sm" disabled>
        {t("Settings", "CheckNow")}
      </Button>
    </SettingRowShell>
  )
}
