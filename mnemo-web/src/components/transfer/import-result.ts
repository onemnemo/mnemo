import type { TransferWarningDto } from "@/api/types"
import type { TranslateFn } from "@/i18n/types"
import { groupedWarningLines, hasWarningLines } from "@/lib/transfer-warnings"

export interface ImportResultLike {
  succeededFiles: number
  failedFiles: number
  warnings: TransferWarningDto[]
  errors: string[]
}

/** Null when there are no results. */
export function mergeResults<R extends ImportResultLike>(results: readonly R[]): R | null {
  if (results.length === 0) return null
  return results.reduce((sum, next) => {
    const merged = { ...sum } as Record<string, unknown>
    for (const [key, value] of Object.entries(next)) {
      const current = merged[key]
      if (typeof value === "number" && typeof current === "number") merged[key] = current + value
      else if (Array.isArray(value) && Array.isArray(current)) merged[key] = [...current, ...value]
    }
    return merged as R
  })
}

export interface ImportNotice {
  tone: "success" | "warning"
  titleKey: "ImportCompleteTitle" | "ImportFailedTitle"
  description: string
}

/** Counts warnings as well as errors, so a payload that could not be read still shows. */
export function importResultNotice(t: TranslateFn, result: ImportResultLike, importedPhrase: string): ImportNotice {
  const warnings = groupedWarningLines(t, result.warnings)
  const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join("\n")

  if (result.succeededFiles === 0) {
    return {
      tone: "warning",
      titleKey: "ImportFailedTitle",
      description: join(result.errors.join("\n"), ...warnings),
    }
  }

  if (result.failedFiles > 0) {
    return {
      tone: "warning",
      titleKey: "ImportCompleteTitle",
      description: join(
        t("Common", "TransferImportPartialFormat", { 0: importedPhrase, 1: result.errors.join("\n") }),
        ...warnings,
      ),
    }
  }

  return {
    tone: hasWarningLines(result.warnings) ? "warning" : "success",
    titleKey: "ImportCompleteTitle",
    description: join(t("Common", "TransferImportFinishedFormat", { 0: importedPhrase }), ...warnings),
  }
}
