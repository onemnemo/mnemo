import { useDecksQuery } from "@/flashcards/api"
import { useT } from "@/i18n/useT"
import { SelectControl } from "@/settings/components/controls/SelectControl"
import { StepSliderControl } from "@/settings/components/controls/StepSliderControl"
import { ToggleControl } from "@/settings/components/controls/ToggleControl"

import type { WidgetManifest, WidgetSettingSchema } from "../widgets/manifest"
import type { FieldValue } from "./fields"

interface ConfigFieldProps {
  /** Resolves the label and, for a choice, its option labels, in the widget's own namespace. */
  manifest: WidgetManifest
  schema: WidgetSettingSchema
  value: FieldValue
  onChange: (next: FieldValue) => void
}

/**
 * The options a choice offers, whether the manifest names them or points at the user's own data.
 *
 * A hook rather than a prop, because only one setting in the catalogue needs live options and
 * threading a deck list through every field would put the flashcard library in the type of a form
 * row that mostly has nothing to do with it. The query is the library's own, so it is already
 * cached by whatever is behind the dialog.
 */
function useChoices(manifest: WidgetManifest, schema: WidgetSettingSchema) {
  const t = useT()
  const decks = useDecksQuery()

  if (schema.optionSource === "decks") {
    return (decks.data ?? []).map((deck) => ({ value: deck.id, label: deck.name }))
  }
  return (schema.options ?? []).map((option) => ({ value: option.value, label: t(manifest.ns, option.labelKey) }))
}

/**
 * One config row.
 *
 * A range's value sits beside its own label and the track spans the row underneath, because a
 * number at the end of a slider is read as the maximum at least as often as it is read as the
 * current value. A toggle or a choice sits to the right of its label, where it fits.
 */
export function ConfigField({ manifest, schema, value, onChange }: ConfigFieldProps) {
  const t = useT()
  const label = t(manifest.ns, schema.labelKey)
  const choices = useChoices(manifest, schema)

  if (value.type === "range") {
    return (
      <div className="py-3.5">
        <div className="flex items-center justify-between gap-6">
          <p className="text-[13.5px] text-ink">{label}</p>
          <span className="shrink-0 text-[13px] font-medium tabular-nums text-ink-2">
            {Math.round(value.value)}
            {schema.suffix ?? ""}
          </span>
        </div>
        <div className="mt-3">
          <StepSliderControl
            mode="numeric"
            min={schema.minimum ?? 0}
            max={schema.maximum ?? schema.minimum ?? 0}
            step={schema.step ?? 1}
            value={value.value}
            onChange={(next) => onChange({ type: "range", value: next })}
            label={label}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="py-3.5">
      <div className="flex items-center justify-between gap-6">
        <p className="min-w-0 text-[13.5px] text-ink">{label}</p>
        {value.type === "toggle" ? (
          <ToggleControl
            checked={value.value}
            onChange={(next) => onChange({ type: "toggle", value: next })}
            label={label}
          />
        ) : (
          <SelectControl
            value={value.value}
            choices={choices}
            onChange={(next) => onChange({ type: "choice", value: next })}
            label={label}
            placeholder={t("WidgetConfig", "ChoosePlaceholder")}
            className="min-w-[150px] max-w-[200px]"
          />
        )}
      </div>
    </div>
  )
}
