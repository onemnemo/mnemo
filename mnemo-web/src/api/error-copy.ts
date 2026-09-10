/**
 * The words for a failed request.
 *
 * Every failing Host response carries a stable code beside its sentence. The sentence is written
 * once, in C#, in English, and used to reach the toast verbatim, which meant four readers out of
 * five saw a language they did not choose under a title in their own. The code is what this build
 * can put words to: one key per code, under the Errors namespace, so a refusal is worded once for
 * every surface that can receive it.
 */

import { KeyedError } from "@/i18n/keyed-error"
import type { TranslateFn } from "@/i18n/types"

import { ApiError } from "./client"

const ERRORS = "Errors"

/**
 * Translation keys under the Errors namespace, by the code the Host answers with.
 *
 * A code that is missing here falls back to the Host's own sentence. Codes whose sentence is the
 * whole point, a validation detail the client already guards against, stay out on purpose.
 */
export const ERROR_KEYS: Readonly<Record<string, string>> = {
  internal_error: "InternalError",
  not_found: "NotFound",
  notes_migrating: "NotesMigrating",
  trash_reconciling: "TrashReconciling",
  unknown_deck: "UnknownDeck",
  unknown_card: "UnknownCard",
  unknown_fact: "UnknownFact",
  unknown_card_type: "UnknownCardType",
  card_type_in_use: "CardTypeInUse",
  unknown_preset: "UnknownPreset",
  preset_protected: "PresetProtected",
  preset_in_use: "PresetInUse",
  unknown_session: "UnknownSession",
  unknown_note: "UnknownNote",
  unknown_folder: "UnknownFolder",
  unknown_mindmap: "UnknownMindmap",
  unknown_grant: "UnknownGrant",
  invalid_name: "InvalidName",
  invalid_value: "InvalidValue",
  invalid_limit: "InvalidLimit",
  invalid_retention: "InvalidRetention",
  invalid_steps: "InvalidSteps",
  invalid_auto_reveal: "InvalidAutoReveal",
  invalid_day_start: "InvalidDayStart",
  invalid_leech_threshold: "InvalidLeechThreshold",
  invalid_leech_action: "InvalidLeechAction",
  invalid_root: "InvalidRoot",
  nothing_to_capture: "NothingToCapture",
  built_in_template: "BuiltInTemplate",
  invalid_upload: "InvalidUpload",
  empty_upload: "EmptyUpload",
  file_too_large: "FileTooLarge",
  unsupported_image: "UnsupportedImage",
  unsupported_format: "UnsupportedFormat",
  no_uploads: "NoUploads",
  too_many_files: "TooManyFiles",
  invalid_conflict_policy: "InvalidConflictPolicy",
  pdf_unavailable: "PdfUnavailable",
  pdf_failed: "PdfFailed",
  write_failed: "WriteFailed",
  invalid_file_name: "InvalidFileName",
  export_failed: "ExportFailed",
}

/**
 * What a failure toast says under its title.
 *
 * The Host's code is chosen over its sentence wherever this build knows the code, and a surface
 * with wording of its own for a code passes it in and wins. A code this build does not know keeps
 * the Host's sentence so an older client still says something useful. A failure without a stable
 * code gets shared translated wording instead of leaking a browser or operating system sentence
 * in a different language.
 *
 * @param own Wording the calling surface has for particular codes, already translated.
 */
export function describeError(
  t: TranslateFn,
  error: unknown,
  own: Readonly<Record<string, string>> = {},
): string | undefined {
  if (error instanceof KeyedError) return t(error.ns, error.key)
  if (error instanceof ApiError && error.code !== undefined) {
    const wording = own[error.code]
    if (wording !== undefined) return wording
    const key = ERROR_KEYS[error.code]
    if (key !== undefined) return t(ERRORS, key)
    return error.message
  }
  return error instanceof Error ? t(ERRORS, "RequestFailed") : undefined
}
