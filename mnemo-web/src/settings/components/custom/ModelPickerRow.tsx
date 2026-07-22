import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { fetchAiModels } from "@/api/ai"

import { useSettingsStore, useSettingValue } from "../../store"
import { SettingRowShell } from "../SettingRowShell"
import { SelectControl } from "../controls/SelectControl"

/** Mirrors ModelRouter.DefaultModelId, the model used when nothing is saved. */
export const DEFAULT_MODEL_ID = "deepseek/deepseek-v4-flash"

/**
 * A model picker over the curated shortlist.
 *
 * The saved id seeds the list before the catalog arrives, so the control never
 * flashes empty, and it stays in the list if the catalog does not contain it,
 * a hand-set model must not be silently swapped for something else.
 */
export function ModelPickerRow({
  settingKey,
  title,
  description,
  divider,
}: {
  settingKey: string
  title: string
  description?: string
  divider: boolean
}) {
  const saved = useSettingValue(settingKey, DEFAULT_MODEL_ID)
  const setValue = useSettingsStore((s) => s.setValue)
  const { data, isPending } = useQuery({ queryKey: ["ai", "models", "curated"], queryFn: () => fetchAiModels() })

  const choices = useMemo(() => {
    const list = (data ?? []).map((m) => ({ value: m.id, label: m.displayName }))
    if (!list.some((c) => c.value === saved)) list.unshift({ value: saved, label: saved })
    return list
  }, [data, saved])

  return (
    <SettingRowShell title={title} description={description} divider={divider}>
      <SelectControl
        value={saved}
        choices={choices}
        onChange={(next) => void setValue(settingKey, next)}
        disabled={isPending}
        label={title}
        className="min-w-[190px]"
      />
    </SettingRowShell>
  )
}
