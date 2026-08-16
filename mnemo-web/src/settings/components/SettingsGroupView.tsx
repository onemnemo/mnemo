import { useT } from "@/i18n/useT"
import { dialog } from "@/stores/dialog"

import { rowDescription, rowTitle } from "../labels"
import { isRowHidden } from "../schema"
import { useSettingsStore, useSettingValue } from "../store"
import type { SettingsGroup, SettingsSchemaContext, SettingsRow } from "../types"
import { SettingRow } from "./SettingRow"
import { SettingRowShell } from "./SettingRowShell"
import { ToggleControl } from "./controls/ToggleControl"

/** One group: an optional heading, then its rows, or a master switch gating them. */
export function SettingsGroupView({
  group,
  context,
}: {
  group: SettingsGroup
  context: SettingsSchemaContext
}) {
  const t = useT()
  const rows = group.rows.filter((row) => !isRowHidden(row, context))
  if (rows.length === 0 && !group.master) return null

  return (
    <section className="mt-8 first:mt-6">
      {/* Sentence case, not letterspaced uppercase. An all-caps micro-label shouts a word like
          "APPLICATION" louder than the page title it sits under. */}
      {group.title ? <h2 className="mb-1 text-[12.5px] font-medium text-ink-3">{t("Settings", group.title)}</h2> : null}

      {group.master ? (
        <MasterGatedRows group={group} rows={rows} />
      ) : (
        <RowList rows={rows} />
      )}
    </section>
  )
}

/**
 * A group whose rows only exist while its master switch is on. While off, the switch
 * stands alone above a count of what it would reveal, matching the desktop.
 */
function MasterGatedRows({ group, rows }: { group: SettingsGroup; rows: SettingsRow[] }) {
  const t = useT()
  const master = group.master!
  const enabled = useSettingValue(master.key, master.defaultValue)
  const setValue = useSettingsStore((s) => s.setValue)
  const title = rowTitle(master, t)

  // Subheaders are scaffolding, not settings, so they are not counted as hidden.
  const hiddenCount = rows.filter((row) => row.kind !== "subheader").length

  async function toggle(next: boolean) {
    // Enabling asks first; disabling is immediate.
    if (next && group.confirmEnable) {
      const confirmed = await dialog.confirm({
        title: t("Settings", group.confirmEnable.title),
        message: t("Settings", group.confirmEnable.message),
        confirmLabel: t("Settings", group.confirmEnable.confirm),
        cancelLabel: t("Common", "Cancel"),
      })
      if (!confirmed) return
    }

    await setValue(master.key, next)
  }

  return (
    <>
      <SettingRowShell
        title={title}
        description={
          enabled
            ? rowDescription(master, t)
            : t("Settings", "HiddenSettingsFormat", { 0: hiddenCount })
        }
        divider={enabled}
      >
        <ToggleControl checked={enabled} onChange={(next) => void toggle(next)} label={title} />
      </SettingRowShell>

      {enabled ? (
        <RowList rows={rows} />
      ) : group.offNotice ? (
        <p className="mt-3 rounded-lg bg-canvas-sunken p-3 text-[12.5px] leading-relaxed text-ink-3">
          {t("Settings", group.offNotice)}
        </p>
      ) : null}
    </>
  )
}

/** Renders rows in order, dropping the trailing divider so a group does not end on a line. */
function RowList({ rows }: { rows: SettingsRow[] }) {
  return (
    <>
      {rows.map((row, i) => (
        <SettingRow key={rowKey(row, i)} row={row} divider={i < rows.length - 1} />
      ))}
    </>
  )
}

function rowKey(row: SettingsRow, index: number): string {
  if ("key" in row) return row.key
  if ("id" in row && row.id) return row.id
  return String(index)
}
