import type { ReactNode } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"
import type { TranslateFn } from "@/i18n/types"
import { openExternally } from "@/lib/external"
import { toast } from "@/stores/toast"

import { openHostFolder, type HostFolder } from "../folders"
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
      // Sentence case, matching the group headings above it. A letterspaced all-caps
      // micro-label shouts a word like "WEB SEARCH" louder than the page title it sits under.
      return <div className="pb-1 pt-6 text-[12.5px] font-medium text-ink-3">{rowTitle(row, t)}</div>
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
  const variant = row.destructive ? "danger" : "outline"
  const press = actionPress(row, t)

  return (
    <SettingRowShell title={rowTitle(row, t)} description={rowDescription(row, t)} divider={divider}>
      {press ? (
        <Button variant={variant} size="sm" onClick={press.run} trailing={press.icon}>
          {label}
        </Button>
      ) : (
        // An action row with nothing behind it is rendered disabled rather than as a
        // button that silently does nothing when pressed.
        <Button variant={variant} size="sm" disabled>
          {label}
        </Button>
      )}
    </SettingRowShell>
  )
}

/** What an action row's button does, or undefined when the row has nothing behind it. */
function actionPress(row: ActionRow, t: TranslateFn): { run: () => void; icon: ReactNode } | undefined {
  if (row.href) {
    return { run: () => openExternally(row.href!), icon: <ActionIcon name="external-link" /> }
  }

  if (!row.action) return undefined

  switch (row.action) {
    case "open-log-folder":
      return { run: () => revealFolder("logs", t), icon: <ActionIcon name="folder-open" /> }

    case "open-data-folder":
      return { run: () => revealFolder("data", t), icon: <ActionIcon name="folder-open" /> }
  }

  // Same guard the custom rows use: an unhandled name is a build failure rather than a
  // button that renders fine and does nothing.
  const unhandled: never = row.action
  throw new Error(`[settings] no handler for action row "${String(unhandled)}"`)
}

function ActionIcon({ name }: { name: string }) {
  return <AppIcon name={name} size={13} strokeWidth={1.7} className="text-ink-icon" />
}

function revealFolder(target: HostFolder, t: TranslateFn): void {
  void openHostFolder(target).then((failure) => {
    if (!failure) return
    toast.warning(t("Settings", failure === "missing" ? "FolderMissing" : "FolderOpenFailed"))
  })
}
