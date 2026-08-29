import { useT } from "@/i18n/useT"
import type { TranslateFn } from "@/i18n/types"
import { useUpdateStore } from "@/updates/store"
import { UpdateChannel, type UpdateChannelName } from "@/updates/types"

import { useSettingsStore, useSettingValue } from "../../store"
import { SettingRowShell } from "../SettingRowShell"
import { SelectControl, type SelectChoice } from "../controls/SelectControl"

const SETTING_KEY = "Updates.Channel"

/**
 * Offers Nightly when selected or when the running build is a nightly.
 */
export function ReleaseChannelRow({
  title,
  divider,
}: {
  title: string
  description?: string
  divider: boolean
}) {
  const t = useT()
  const selected = useSettingValue(SETTING_KEY, UpdateChannel.Stable) as UpdateChannelName
  const runningChannel = useUpdateStore((s) => s.status?.runningChannel)
  const setValue = useSettingsStore((s) => s.setValue)

  async function choose(next: string) {
    await setValue(SETTING_KEY, next)
    // The host drops whatever the old track had found, so the row above has to be told
    // rather than left describing an update this channel may not publish.
    await useUpdateStore.getState().refresh()
  }

  return (
    <SettingRowShell title={title} description={describe(selected, t)} divider={divider}>
      <SelectControl
        value={selected}
        choices={choices(selected, runningChannel, t)}
        onChange={(next) => void choose(next)}
        label={title}
      />
    </SettingRowShell>
  )
}

/**
 * The running channel remains unknown until update status arrives.
 */
function choices(
  selected: UpdateChannelName,
  running: UpdateChannelName | undefined,
  t: TranslateFn,
): SelectChoice[] {
  const offered: SelectChoice[] = [
    { value: UpdateChannel.Stable, label: t("Settings", "ReleaseChannelStable") },
    { value: UpdateChannel.Beta, label: t("Settings", "ReleaseChannelBeta") },
  ]

  if (selected === UpdateChannel.Nightly || running === UpdateChannel.Nightly)
    offered.push({ value: UpdateChannel.Nightly, label: t("Settings", "ReleaseChannelNightly") })

  return offered
}

/** What following this track means, in the row's own description. */
function describe(selected: UpdateChannelName, t: TranslateFn): string {
  switch (selected) {
    case UpdateChannel.Beta:
      return t("Settings", "ReleaseChannelBetaDescription")
    case UpdateChannel.Nightly:
      return t("Settings", "ReleaseChannelNightlyDescription")
    default:
      return t("Settings", "ReleaseChannelStableDescription")
  }
}
