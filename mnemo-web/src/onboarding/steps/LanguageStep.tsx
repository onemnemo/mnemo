import { useQuery } from "@tanstack/react-query"

import { fetchLanguages } from "@/i18n/api"
import { useI18nStore } from "@/i18n/store"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

/**
 * Language choice, applied immediately so the rest of the wizard is already in the
 * chosen language when the user moves on.
 */
export function LanguageStep() {
  const t = useT()
  const language = useI18nStore((s) => s.language)
  const setLanguage = useI18nStore((s) => s.setLanguage)
  const { data } = useQuery({ queryKey: ["i18n", "languages"], queryFn: fetchLanguages })

  return (
    <ul className="space-y-1.5 py-2">
      {(data ?? []).map((option) => {
        const selected = option.code === language

        return (
          <li key={option.code}>
            <button
              type="button"
              onClick={() => void setLanguage(option.code)}
              aria-pressed={selected}
              className={cn(
                "flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors",
                selected ? "border-brand ring-1 ring-brand" : "hover:border-text-faded",
              )}
            >
              <span className="text-body-small font-medium text-text-primary">{option.nativeName}</span>
              <span className="text-caption text-text-tertiary">{option.name}</span>
            </button>
          </li>
        )
      })}
      {(data ?? []).length === 0 ? (
        <li className="py-2 text-body-small text-text-tertiary">{t("Settings", "Language")}</li>
      ) : null}
    </ul>
  )
}
