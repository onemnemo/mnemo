import { useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { useI18nStore } from "@/i18n/store"
import { useT } from "@/i18n/useT"
import { useInvalidateProofing, useProofingPersonalWords, useProofingStatus } from "@/notes/proofing/status"
import { useSettingsStore, useSettingValue } from "@/settings/store"

import { Block, Row, Section, SettingsPageShell } from "../kit"
import { ProofingLanguagePicker } from "./ProofingLanguagePicker"
import { ProofingLanguageRow } from "./ProofingLanguageRow"
import { ProofingWordsDialog } from "./ProofingWordsDialog"
import { describeState, labelOf, moveLanguage, withLanguage, withoutLanguage } from "./proofing-languages"

const NS = "Settings"

/** Added words named in the row itself, before the rest become a count. */
const PREVIEW = 4

/**
 * Spelling, in Application rather than under Notes.
 *
 * It reads at first like a notes setting, but a card front and a mind map node
 * are prose the user typed too, and the moment this lives under Notes the
 * others either go unchecked or grow a second copy of the same switch.
 *
 * The active set and what each dictionary is doing come from the host's status,
 * never from the stored key: resolving it takes the stored preference, the
 * older spellcheck setting and what is actually installed, and only the host
 * can see all three. So a write stores the key and then asks the host again
 * rather than assuming the write is the answer.
 */
export function ProofingPage() {
  const t = useT()
  const st = (key: string, params?: Record<string, string | number>) => t(NS, key, params)
  const bundle = useI18nStore((state) => state.bundle)
  const shipped = (key: string) => bundle[NS]?.[key] !== undefined

  const { data: status } = useProofingStatus()
  const { data: personal } = useProofingPersonalWords()
  const invalidate = useInvalidateProofing()
  const enabled = useSettingValue("Proofing.Enabled", true)
  const setValue = useSettingsStore((state) => state.setValue)
  const [dialog, setDialog] = useState<"languages" | "words" | null>(null)

  const catalog = status?.languages ?? []
  const active = status?.active ?? []
  const words = personal?.words ?? []

  // Through the settings store like every other written key, so one cache holds
  // the stored value and the store's own rollback covers a failed write. The
  // host still owns which languages are effective, which is why the status is
  // invalidated rather than assumed to follow.
  async function writeLanguages(next: readonly string[]) {
    if (next === active) return
    await setValue("Proofing.Languages", next)
    invalidate()
  }

  const count =
    words.length === 1 ? st("ProofingPersonalCountOne", { 0: 1 }) : st("ProofingPersonalCountMany", { 0: words.length })

  const preview =
    words.length === 0
      ? st("ProofingPersonalNone")
      : words.length > PREVIEW
        ? st("ProofingPersonalPreviewFormat", {
            0: words.slice(0, PREVIEW).map((entry) => entry.word).join(", "),
            1: words.length - PREVIEW,
          })
        : words.map((entry) => entry.word).join(", ")

  return (
    <SettingsPageShell>
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
      </Section>

      <Section title={st("ProofingLanguagesTitle")} note={st("ProofingLanguagesNote")}>
        {/* Nothing at all until the host has answered: an empty active set and an
            unanswered one look the same here, and only one of them means the user
            has switched everything off. */}
        {!status ? null : active.length === 0 ? (
          <Block label={st("ProofingNoLanguages")} description={st("ProofingNoLanguagesDescription")}>
            <Button
              icon={<AppIcon name="plus" size={14} strokeWidth={1.8} />}
              onClick={() => setDialog("languages")}
            >
              {st("ProofingAddLanguage")}
            </Button>
          </Block>
        ) : (
          <>
            {active.map((id, index) => {
              const language = catalog.find((entry) => entry.id === id)
              const label = language ? labelOf(language, catalog) : id
              return (
                <ProofingLanguageRow
                  key={id}
                  label={label}
                  state={language ? describeState(language, st, shipped) : st("ProofingStateAbsent")}
                  primary={index === 0}
                  canMoveUp={index > 0}
                  canMoveDown={index < active.length - 1}
                  onMoveUp={() => void writeLanguages(moveLanguage(active, id, -1))}
                  onMoveDown={() => void writeLanguages(moveLanguage(active, id, 1))}
                  onRemove={() => void writeLanguages(withoutLanguage(active, id))}
                />
              )
            })}

            <button
              type="button"
              onClick={() => setDialog("languages")}
              className="flex w-full items-center gap-2 rounded-lg py-3 text-left text-[13.5px] text-ink-2 transition-colors hover:text-ink"
              style={{ transitionDuration: "var(--duration-fast)" }}
            >
              <AppIcon name="plus" size={15} strokeWidth={1.8} className="text-ink-icon" />
              {st("ProofingAddLanguage")}
            </button>
          </>
        )}
      </Section>

      <Section title={st("ProofingPersonalTitle")}>
        <Row label={st("ProofingPersonalAddedWords")} description={preview}>
          <div className="flex items-center gap-2.5">
            <span className="shrink-0 text-[12.5px] text-ink-3 tabular-nums">{count}</span>
            <Button
              variant="outline"
              icon={<AppIcon name="book-open" size={14} strokeWidth={1.7} />}
              onClick={() => setDialog("words")}
            >
              {st("ProofingPersonalManage")}
            </Button>
          </div>
        </Row>
      </Section>

      {dialog === "languages" && (
        <ProofingLanguagePicker
          onClose={() => setDialog(null)}
          languages={catalog}
          active={active}
          onAdd={(id) => void writeLanguages(withLanguage(active, id))}
        />
      )}
      {dialog === "words" && <ProofingWordsDialog onClose={() => setDialog(null)} languages={catalog} />}
    </SettingsPageShell>
  )
}
