import { useQuery } from "@tanstack/react-query"

import { fetchLanguages } from "@/i18n/api"
import { useI18nStore } from "@/i18n/store"

import { SettingRowShell } from "../SettingRowShell"
import { SelectControl } from "../controls/SelectControl"

/**
 * The language switch. Changing it both persists App.Language and swaps the live
 * bundle, matching the desktop where those are one action — every settings label
 * re-resolves immediately.
 */
export function LanguageRow({
  title,
  description,
  divider,
}: {
  title: string
  description?: string
  divider: boolean
}) {
  const language = useI18nStore((s) => s.language)
  const setLanguage = useI18nStore((s) => s.setLanguage)
  const { data } = useQuery({ queryKey: ["i18n", "languages"], queryFn: fetchLanguages })

  const choices = (data ?? []).map((l) => ({ value: l.code, label: l.nativeName }))

  return (
    <SettingRowShell title={title} description={description} divider={divider}>
      <SelectControl
        value={language}
        choices={choices.length > 0 ? choices : [{ value: language, label: language }]}
        onChange={(next) => void setLanguage(next)}
        label={title}
      />
    </SettingRowShell>
  )
}
