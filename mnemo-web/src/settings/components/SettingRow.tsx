import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"
import type { TranslateFn } from "@/i18n/types"

import { optionLabel, optionValue, rowDescription, rowTitle } from "../labels"
import { useSecretIsSet, useSettingsStore, useSettingValue } from "../store"
import type {
  ActionRow,
  DropdownRow,
  SettingsRow,
  StepSliderRow,
  TextRow,
  ToggleRow,
} from "../types"
import { CustomRow } from "./CustomRow"
import { SettingRowShell } from "./SettingRowShell"
import { SelectControl } from "./controls/SelectControl"
import { StepSliderControl } from "./controls/StepSliderControl"
import { TextControl } from "./controls/TextControl"
import { ToggleControl } from "./controls/ToggleControl"

/** Renders one schema row, bound to its stored value. */
export function SettingRow({ row, divider }: { row: SettingsRow; divider: boolean }) {
  const t = useT()

  switch (row.kind) {
    case "subheader":
      return (
        <div className="pb-1 pt-5 text-micro font-semibold uppercase tracking-[1px] text-text-faded">
          {rowTitle(row, t)}
        </div>
      )
    case "notice":
      return (
        <SettingRowShell title={rowTitle(row, t)} description={rowDescription(row, t)} divider={divider} />
      )
    case "toggle":
      return <ToggleSettingRow row={row} divider={divider} t={t} />
    case "dropdown":
      return <DropdownSettingRow row={row} divider={divider} t={t} />
    case "text":
      return <TextSettingRow row={row} divider={divider} t={t} />
    case "slider":
      return <SliderSettingRow row={row} divider={divider} t={t} />
    case "action":
      return <ActionSettingRow row={row} divider={divider} t={t} />
    case "custom":
      return <CustomRow row={row} divider={divider} />
  }
}

function ToggleSettingRow({ row, divider, t }: { row: ToggleRow; divider: boolean; t: TranslateFn }) {
  const value = useSettingValue(row.key, row.defaultValue)
  const setValue = useSettingsStore((s) => s.setValue)
  const title = rowTitle(row, t)

  return (
    <SettingRowShell title={title} description={rowDescription(row, t)} divider={divider}>
      <ToggleControl checked={value} onChange={(next) => void setValue(row.key, next)} label={title} />
    </SettingRowShell>
  )
}

function DropdownSettingRow({ row, divider, t }: { row: DropdownRow; divider: boolean; t: TranslateFn }) {
  const setValue = useSettingsStore((s) => s.setValue)
  const choices = row.options.map((o) => ({
    value: optionValue(o, t, row.localizedValues),
    label: optionLabel(o, t),
  }))
  const stored = useSettingValue(row.key, row.defaultValue)
  const title = rowTitle(row, t)

  // A value saved under another language (or removed from the list) would leave the
  // trigger blank; fall back to the default so the row still reads as configured.
  const value = choices.some((c) => c.value === stored) ? stored : (choices[0]?.value ?? "")

  return (
    <SettingRowShell
      title={title}
      description={rowDescription(row, t)}
      divider={divider}
      dimmed={row.disabled}
    >
      <SelectControl
        value={value}
        choices={choices}
        onChange={(next) => void setValue(row.key, next)}
        disabled={row.disabled}
        label={title}
      />
    </SettingRowShell>
  )
}

function TextSettingRow({ row, divider, t }: { row: TextRow; divider: boolean; t: TranslateFn }) {
  const setValue = useSettingsStore((s) => s.setValue)
  const stored = useSettingValue(row.key, row.defaultValue)
  const secretIsSet = useSecretIsSet(row.key)
  const title = rowTitle(row, t)

  // A secret is never sent back, so the field starts empty and shows whether one is
  // saved. Typing replaces it; leaving it untouched changes nothing.
  const value = row.secret ? "" : stored
  const placeholder = row.secret && secretIsSet ? "••••••••••••" : row.placeholder

  return (
    <SettingRowShell title={title} description={rowDescription(row, t)} divider={divider}>
      <TextControl
        value={value}
        onCommit={(next) => void setValue(row.key, next)}
        label={title}
        placeholder={placeholder}
        secret={row.secret}
      />
    </SettingRowShell>
  )
}

function SliderSettingRow({ row, divider, t }: { row: StepSliderRow; divider: boolean; t: TranslateFn }) {
  const setValue = useSettingsStore((s) => s.setValue)
  const steps = row.options.map((o) => optionValue(o, t, row.localizedValues))
  const stored = useSettingValue(row.key, row.defaultValue)
  const title = rowTitle(row, t)

  return (
    <SettingRowShell title={title} description={rowDescription(row, t)} divider={divider}>
      <StepSliderControl
        steps={steps}
        value={stored}
        onChange={(next) => void setValue(row.key, next)}
        label={title}
      />
    </SettingRowShell>
  )
}

function ActionSettingRow({ row, divider, t }: { row: ActionRow; divider: boolean; t: TranslateFn }) {
  const label = row.buttonLabelText ?? (row.buttonLabel ? t("Settings", row.buttonLabel) : "")

  return (
    <SettingRowShell title={rowTitle(row, t)} description={rowDescription(row, t)} divider={divider}>
      {/* The only schema action row is the desktop's cache button, which has never had
          a command behind it. Rendered disabled rather than as a button that does nothing. */}
      <Button variant={row.destructive ? "danger" : "outline"} size="sm" disabled>
        {label}
      </Button>
    </SettingRowShell>
  )
}
