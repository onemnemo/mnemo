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
 * One config row, built from the settings module's own controls rather than a widget-only set.
 *
 * Layout follows the desktop: a range sits below its label and spans the row, so a slider has room;
 * a toggle or a choice sits to the right of its label. That is why this owns the row shell rather
 * than returning a bare control, the placement differs by field type.
 */
export function ConfigField({ manifest, schema, value, onChange }: ConfigFieldProps) {
  const t = useT()
  const label = t(manifest.ns, schema.labelKey)

  if (value.type === "range") {
    return (
      <div className="mb-3.5 flex flex-col gap-1.5">
        <span className="text-body-small text-text-primary">{label}</span>
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
    )
  }

  return (
    <div className="mb-3.5 grid grid-cols-[1fr_auto] items-center gap-x-3">
      <span className="text-body-small text-text-primary">{label}</span>
      {value.type === "toggle" ? (
        <ToggleControl
          checked={value.value}
          onChange={(next) => onChange({ type: "toggle", value: next })}
          label={label}
        />
      ) : (
        <SelectControl
          value={value.value}
          choices={(schema.options ?? []).map((option) => ({
            value: option.value,
            label: t(manifest.ns, option.labelKey),
          }))}
          onChange={(next) => onChange({ type: "choice", value: next })}
          label={label}
          className="min-w-[150px]"
        />
      )}
    </div>
  )
}
