import { useQuery } from "@tanstack/react-query"

import { fetchLanguages } from "@/i18n/api"
import { useI18nStore } from "@/i18n/store"
import { useT } from "@/i18n/useT"
import { SelectControl } from "@/settings/components/controls/SelectControl"

import { Head, Line } from "./kit"

/**
 * Language, applied immediately. The flow is the one place where picking a language has
 * to prove it did something: a dropdown that changes nothing on screen is
 * indistinguishable from one that is not wired up.
 */
export function LanguageStep() {
  const t = useT()
  const language = useI18nStore((s) => s.language)
  const setLanguage = useI18nStore((s) => s.setLanguage)
  const { data } = useQuery({ queryKey: ["i18n", "languages"], queryFn: fetchLanguages })

  const choices = (data ?? []).map((option) => ({ value: option.code, label: option.nativeName }))
  const label = t("Onboarding", "LangLabel")

  return (
    <>
      <Head title={t("Onboarding", "LangTitle")} body={t("Onboarding", "LangBody")} />

      <div className="mt-8">
        <Line label={label}>
          <SelectControl
            value={language}
            choices={choices.length > 0 ? choices : [{ value: language, label: language }]}
            onChange={(next) => void setLanguage(next)}
            label={label}
          />
        </Line>
      </div>
    </>
  )
}
