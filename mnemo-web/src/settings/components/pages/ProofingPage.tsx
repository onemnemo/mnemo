import { useState } from "react"

import { useT } from "@/i18n/useT"
import { useI18nStore } from "@/i18n/store"
import { Switch } from "@/components/ui/switch"
import { putSettingValue } from "@/settings/api"
import { useSettingsStore, useSettingValue } from "@/settings/store"
import { useInvalidateProofing, useProofingStatus } from "@/notes/proofing/status"
import type { ProofingLanguage } from "@/notes/proofing/types"
import { toast } from "@/stores/toast"

import { SelectControl } from "../controls/SelectControl"
import { labelOf, languageChoices } from "./proofing-languages"
import { Row, Section, SettingsPageShell } from "../kit"
import { ProofingPersonalWords } from "./ProofingPersonalWords"

const NS = "Settings"

/**
 * Spelling, in Application rather than under Notes.
 *
 * It reads at first like a notes setting, but a card front and a mind map node
 * are prose the user typed too, and the moment this lives under Notes the
 * others either go unchecked or grow a second copy of the same switch.
 *
 * The effective language and what each dictionary is doing come from the host's
 * status, never from the stored key: resolving it takes the stored preference,
 * the older spellcheck setting and what is actually installed, and only the
 * host can see all three. So the select writes the key and then asks the host
 * again rather than assuming the write is the answer.
 */
export function ProofingPage() {
  const t = useT()
  const st = (key: string, params?: Record<string, string | number>) => t(NS, key, params)
  const bundle = useI18nStore((state) => state.bundle)

  const { data: status } = useProofingStatus()
  const invalidate = useInvalidateProofing()
  const enabled = useSettingValue("Proofing.Enabled", true)
  const setValue = useSettingsStore((state) => state.setValue)
  const [pendingLanguage, setPendingLanguage] = useState<string | null>(null)

  const languages = status?.languages ?? []
  const offered = languageChoices(languages, st("ProofingStateLoading"))
  const selected = pendingLanguage ?? status?.language ?? ""

  async function chooseLanguage(next: string) {
    setPendingLanguage(next)
    try {
      await putSettingValue("Proofing.Language", next)
    } catch {
      setPendingLanguage(null)
      toast.warning(t("Common", "Error"))
      return
    }
    setPendingLanguage(null)
    invalidate()
  }

  return (
    <SettingsPageShell title={st("ProofingCategoryTitle")} description={st("ProofingSubtitle")}>
      <Section>
        <Row label={st("ProofingEnable")} description={st("ProofingEnableDescription")}>
          <Switch
            checked={enabled}
            label={st("ProofingEnable")}
            onChange={(next) => {
              void setValue("Proofing.Enabled", next).then(invalidate)
            }}
          />
        </Row>

        <Row label={st("ProofingLanguage")} description={st("ProofingLanguageDescription")}>
          {/* No select at all rather than one holding an empty option: a Radix
              item cannot carry an empty value, and a picker with nothing to
              pick is a control that answers no question. */}
          {offered.length === 0 ? (
            <p className="text-[12.5px] text-ink-3">{st("ProofingNoLanguageReady")}</p>
          ) : (
            <SelectControl
              value={selected}
              label={st("ProofingLanguage")}
              choices={offered}
              onChange={(next) => void chooseLanguage(next)}
            />
          )}
        </Row>
      </Section>

      <Section title={st("ProofingLanguagesTitle")} note={st("ProofingLanguagesNote")}>
        {languages.map((language) => (
          <Row
            key={language.id}
            label={labelOf(language)}
            description={describe(language, st, (key) => bundle[NS]?.[key] !== undefined)}
          >
            {language.bundled ? <span className="text-[12.5px] text-ink-3">{st("ProofingBundled")}</span> : null}
          </Row>
        ))}
      </Section>

      <ProofingPersonalWords />
    </SettingsPageShell>
  )
}

/**
 * What a dictionary is doing, in one line.
 *
 * The host's own reason is appended only when this build ships a translation
 * for it: a key that does not resolve renders as the key itself, which reads
 * as a bug to every user who sees it.
 */
function describe(
  language: ProofingLanguage,
  st: (key: string) => string,
  shipped: (key: string) => boolean,
): string {
  if (language.state === "ready") return st("ProofingStateReady")
  if (language.state === "loading") return st("ProofingStateLoading")
  // Japanese has no dictionary this engine can read, which is a different
  // answer from one that has simply not been bundled yet.
  if (language.id.toLowerCase().startsWith("ja")) return st("ProofingStateUnsupported")
  const absent = st("ProofingStateAbsent")
  if (language.reasonKey && shipped(language.reasonKey)) return `${absent}. ${st(language.reasonKey)}`
  return absent
}
