import type { TransferWarningDto } from "@/api/types"
import type { TranslateFn } from "@/i18n/types"

// Groups repeated import warnings into one line with a count and a few example names, so a
// large Anki import's media warnings do not bury the rest of the notice. The host still logs
// the full list.

/**
 * How one warning key is grouped: which param names the item, and which carries the reason.
 * `noReasonKey` is the sentence used when the reason resolves to nothing. Keys not listed
 * render one per line.
 */
type GroupSpec =
  | { groupedKey: string; identityParam: string; reasonParam?: undefined; noReasonKey?: undefined }
  | { groupedKey: string; identityParam: string; reasonParam: string; noReasonKey: string }

const GROUPABLE: Readonly<Record<string, GroupSpec>> = {
  AnkiMediaImportFailed: {
    groupedKey: "AnkiMediaImportFailedCount",
    identityParam: "mediaName",
    reasonParam: "error",
    noReasonKey: "AnkiMediaImportFailedNoReasonCount",
  },
  AnkiMediaImportFailedUnknown: { groupedKey: "AnkiMediaImportFailedUnknownCount", identityParam: "mediaName" },
  AnkiMediaNotFound: { groupedKey: "AnkiMediaNotFoundCount", identityParam: "mediaName" },
  AnkiDeckImportFailed: {
    groupedKey: "AnkiDeckImportFailedCount",
    identityParam: "deckName",
    reasonParam: "error",
    noReasonKey: "AnkiDeckImportFailedNoReasonCount",
  },
  AnkiEntryUnpackFailed: {
    groupedKey: "AnkiEntryUnpackFailedCount",
    identityParam: "entryName",
    reasonParam: "error",
    noReasonKey: "AnkiEntryUnpackFailedNoReasonCount",
  },
  NoteImportFailed: {
    groupedKey: "NoteImportFailedCount",
    identityParam: "noteTitle",
    reasonParam: "error",
    noReasonKey: "NoteImportFailedNoReasonCount",
  },
  NoteFolderImportFailed: {
    groupedKey: "NoteFolderImportFailedCount",
    identityParam: "folderName",
    reasonParam: "error",
    noReasonKey: "NoteFolderImportFailedNoReasonCount",
  },
  MindmapImportFailed: {
    groupedKey: "MindmapImportFailedCount",
    identityParam: "mapTitle",
    reasonParam: "error",
    noReasonKey: "MindmapImportFailedNoReasonCount",
  },
  SettingsKeyNotAllowed: { groupedKey: "SettingsKeyNotAllowedCount", identityParam: "settingKey" },
}

/** Names collected into a grouped warning's "for example" list. */
const MAX_EXAMPLES = 3

function translateWarning(t: TranslateFn, warning: TransferWarningDto): string {
  return t("TransferWarnings", warning.key, warning.params)
}

/**
 * Trims one trailing period so a reason spliced into "{reason}. For example" does not double
 * it. An ellipsis is left alone.
 */
export function withoutTrailingPeriod(text: string): string {
  const trimmed = text.trim()
  if (trimmed.endsWith("...")) return trimmed
  return trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed
}

/** The reason text for a group, or null when the key has none or it resolved to nothing. */
function reasonFor(spec: GroupSpec, warning: TransferWarningDto): string | null {
  if (!spec.reasonParam) return null
  const reason = withoutTrailingPeriod(warning.params[spec.reasonParam] ?? "")
  return reason.length > 0 ? reason : null
}

/**
 * The warning's key plus every param except the item's name, or null when it cannot group. The
 * reason is normalised as displayed, so "X" and "X." group together.
 */
function groupKeyOf(warning: TransferWarningDto): string | null {
  const spec = GROUPABLE[warning.key]
  if (!spec || warning.params[spec.identityParam] === undefined) return null

  const rest = Object.keys(warning.params)
    .filter((name) => name !== spec.identityParam)
    .sort()
    .map((name) => {
      const value = name === spec.reasonParam ? withoutTrailingPeriod(warning.params[name] ?? "") : warning.params[name]
      return `${name}=${value}`
    })
  return `${warning.key}\u0000${rest.join("\u0000")}`
}

/** Quoted example names, with a count of the rest past the cap. */
function formatExamples(t: TranslateFn, names: readonly string[]): string {
  const shown = names.slice(0, MAX_EXAMPLES).map((name) => t("TransferWarnings", "ExampleItemFormat", { name }))
  const remaining = names.length - shown.length
  return remaining > 0
    ? t("TransferWarnings", "GroupedExamplesMoreFormat", { examples: shown.join(", "), count: remaining })
    : shown.join(", ")
}

function renderGroup(t: TranslateFn, members: readonly TransferWarningDto[]): string {
  const spec = GROUPABLE[members[0].key]!
  const examples = formatExamples(
    t,
    members.map((member) => member.params[spec.identityParam]),
  )
  const reason = reasonFor(spec, members[0])

  if (spec.reasonParam && reason === null) {
    return t("TransferWarnings", spec.noReasonKey, { count: members.length, examples })
  }
  return t("TransferWarnings", spec.groupedKey, {
    count: members.length,
    reason: reason ?? "",
    examples,
  })
}

/**
 * A transfer result's warnings as display lines in first-seen order, repeats collapsed into one
 * grouped line. A warning with no repeat renders as it would alone.
 */
export function groupedWarningLines(t: TranslateFn, warnings: readonly TransferWarningDto[]): string[] {
  const members = new Map<string, TransferWarningDto[]>()
  // A lone warning, or a group key recorded where its first member appeared.
  const slots: (TransferWarningDto | string)[] = []

  for (const warning of warnings) {
    const key = groupKeyOf(warning)
    if (key === null) {
      slots.push(warning)
      continue
    }
    const existing = members.get(key)
    if (existing) {
      existing.push(warning)
    } else {
      members.set(key, [warning])
      slots.push(key)
    }
  }

  return slots.map((slot) => {
    if (typeof slot !== "string") return translateWarning(t, slot)
    const group = members.get(slot)!
    return group.length === 1 ? translateWarning(t, group[0]) : renderGroup(t, group)
  })
}
