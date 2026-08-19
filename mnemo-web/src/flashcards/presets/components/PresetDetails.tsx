import type { ReactNode } from "react"

import type { AutoReveal } from "@/api/types"
import { useT } from "@/i18n/useT"
import { SettingRowShell } from "@/settings/components/SettingRowShell"
import { SelectControl } from "@/settings/components/controls/SelectControl"
import { ToggleControl } from "@/settings/components/controls/ToggleControl"

import { NumberStepper } from "../controls/NumberStepper"
import { RetentionSlider } from "../controls/RetentionSlider"
import { StepsField } from "../controls/StepsField"
import {
  DAY_START_HOURS,
  MAX_NEW_PER_DAY,
  MAX_REVIEWS_PER_DAY,
  retentionPercent,
  type PresetDraft,
} from "../presets"

/** The editor for the selected preset: daily limits, scheduling, session behaviour. */
export function PresetDetails({
  draft,
  stepsText,
  stepsInvalid,
  onPatch,
  onStepsTextChange,
}: {
  draft: PresetDraft
  stepsText: string
  stepsInvalid: boolean
  onPatch: (patch: Partial<PresetDraft>) => void
  onStepsTextChange: (next: string) => void
}) {
  const t = useT()
  const fc = (key: string) => t("Flashcards", key)

  // Plain 24-hour labels rather than localised times: the row is about a boundary, and every
  // locale reads "04:00" the same way.
  const dayStartChoices = DAY_START_HOURS.map((hour) => ({
    value: String(hour),
    label: `${String(hour).padStart(2, "0")}:00`,
  }))

  const autoRevealChoices: { value: AutoReveal; label: string }[] = [
    { value: "off", label: fc("ReviewSettingsAutoRevealOff") },
    { value: "five-seconds", label: fc("ReviewSettingsAutoReveal5s") },
    { value: "ten-seconds", label: fc("ReviewSettingsAutoReveal10s") },
  ]

  return (
    <div className="min-w-0 flex-1 overflow-y-auto px-6 pb-2.5 pt-1.5">
      <Section label={fc("ReviewSettingsDailyLimitsLabel")} first>
        <SettingRowShell title={fc("ReviewSettingsNewPerDayTitle")}>
          <NumberStepper
            value={draft.newPerDay}
            max={MAX_NEW_PER_DAY}
            onChange={(newPerDay) => onPatch({ newPerDay })}
            label={fc("ReviewSettingsNewPerDayTitle")}
          />
        </SettingRowShell>

        <SettingRowShell title={fc("ReviewSettingsMaxReviewsTitle")} divider={false}>
          <NumberStepper
            value={draft.maxReviewsPerDay}
            max={MAX_REVIEWS_PER_DAY}
            onChange={(maxReviewsPerDay) => onPatch({ maxReviewsPerDay })}
            label={fc("ReviewSettingsMaxReviewsTitle")}
          />
        </SettingRowShell>
      </Section>

      <Section label={fc("ReviewSettingsSchedulingLabel")}>
        <SettingRowShell title={fc("ReviewSettingsAlgorithmTitle")}>
          {/* FSRS is the only scheduler, and presets are saved without asking which - the row
              exists to name what is running, as it does on the desktop. */}
          <SelectControl
            value="fsrs"
            choices={[{ value: "fsrs", label: "FSRS-5" }]}
            onChange={() => undefined}
            label={fc("ReviewSettingsAlgorithmTitle")}
          />
        </SettingRowShell>

        <SettingRowShell
          title={fc("ReviewSettingsRetentionTitle")}
          description={fc("ReviewSettingsRetentionDescription")}
        >
          <RetentionSlider
            percent={retentionPercent(draft.desiredRetention)}
            onChange={(percent) => onPatch({ desiredRetention: percent / 100 })}
            label={fc("ReviewSettingsRetentionTitle")}
          />
        </SettingRowShell>

        <SettingRowShell
          title={fc("ReviewSettingsLearningStepsTitle")}
          description={fc("ReviewSettingsLearningStepsDescription")}
        >
          <StepsField
            value={stepsText}
            invalid={stepsInvalid}
            onChange={onStepsTextChange}
            label={fc("ReviewSettingsLearningStepsTitle")}
          />
        </SettingRowShell>

        <SettingRowShell
          title={fc("ReviewSettingsDayStartTitle")}
          description={fc("ReviewSettingsDayStartDescription")}
          divider={false}
        >
          <SelectControl
            value={String(draft.nextDayStartsAtHour)}
            choices={dayStartChoices}
            onChange={(value) => onPatch({ nextDayStartsAtHour: Number(value) })}
            label={fc("ReviewSettingsDayStartTitle")}
          />
        </SettingRowShell>
      </Section>

      <Section label={fc("ReviewSettingsSessionLabel")}>
        <SettingRowShell title={fc("ReviewSettingsShuffleTitle")}>
          <ToggleControl
            checked={draft.shuffleOrder}
            onChange={(shuffleOrder) => onPatch({ shuffleOrder })}
            label={fc("ReviewSettingsShuffleTitle")}
          />
        </SettingRowShell>

        {/* Ships inert on the desktop too - the switch shows the stored value and says why. */}
        <SettingRowShell
          title={fc("ReviewSettingsBuryTitle")}
          description={fc("ReviewSettingsBuryComingSoon")}
          dimmed
        >
          <ToggleControl
            checked={draft.buryRelated}
            onChange={() => undefined}
            disabled
            label={fc("ReviewSettingsBuryTitle")}
          />
        </SettingRowShell>

        <SettingRowShell title={fc("ReviewSettingsAutoRevealTitle")} divider={false}>
          <SelectControl
            value={draft.autoReveal}
            choices={autoRevealChoices}
            onChange={(value) => onPatch({ autoReveal: value as AutoReveal })}
            label={fc("ReviewSettingsAutoRevealTitle")}
          />
        </SettingRowShell>
      </Section>
    </div>
  )
}

function Section({
  label,
  first = false,
  children,
}: {
  label: string
  first?: boolean
  children: ReactNode
}) {
  return (
    <section className={first ? "pt-3" : "pt-5"}>
      <div className="pb-1 text-[12.5px] font-medium text-ink-3">{label}</div>
      {children}
    </section>
  )
}
