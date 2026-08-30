import { dialog } from "@/stores/dialog"
import { toast } from "@/stores/toast"

import { apiFetch, ApiError, apiToken } from "./client"

/**
 * Saving a file the app made or fetched, through the host rather than the browser.
 *
 * A synthetic `<a download>` does produce a file, on every engine the app ships on. What it does
 * not produce is a destination or an outcome: the file lands in the downloads folder rather than
 * anywhere the user chose, and `link.click()` returns identically whether the bytes were written,
 * went somewhere unintended, or failed. A page that cannot observe any of that cannot name a path,
 * cannot tell a cancellation from a failure, and has nothing to base a success message on, which is
 * why five dialogs were reporting one unconditionally.
 *
 * So the host raises the chooser and owns the write. The destination is settled before any work
 * starts, so a file the host produces is written straight to it and never travels here and back.
 * Mnemo.Host/Lifecycle/ExportFileEndpoints.cs is the other half.
 */

/** What became of a file the user asked for. */
export type ExportOutcome =
  /** Written by the host. The path is real and worth showing. */
  | { status: "saved"; path: string }
  /** Handed to the browser, because there is no window and so no destination to choose. */
  | { status: "downloaded" }
  /** The chooser was dismissed. Nothing was written and nothing went wrong. */
  | { status: "cancelled" }

export interface ExportRequest {
  /** What the chooser is pre-filled with. Its extension is the one the saved file will carry. */
  readonly fileName: string
  /** The chooser's title. Passed in because the translations live here, not in the host. */
  readonly dialogTitle: string
  /** Copy for the prompt below. Built by {@link exportSaveOptions} so five dialogs word it once. */
  readonly overwrite: OverwritePrompt
}

/** A save minus the file name, which each dialog supplies from what it is exporting. */
export type ExportSaveOptions = Omit<ExportRequest, "fileName">

/** The strings the overwrite prompt needs. `{0}` in the message is replaced with the path. */
export interface OverwritePrompt {
  readonly title: string
  readonly message: string
  readonly confirmLabel: string
  readonly cancelLabel: string
}

/**
 * Everything a save needs except the file name, built from the `Common` namespace's translate.
 *
 * One builder rather than an object literal at each dialog, so the chooser's title and the
 * overwrite wording cannot drift apart across the five places that export something.
 */
export function exportSaveOptions(common: (key: string) => string): ExportSaveOptions {
  return {
    dialogTitle: common("ExportSaveDialogTitle"),
    overwrite: {
      title: common("ExportOverwriteTitle"),
      message: common("ExportOverwriteMessage"),
      confirmLabel: common("ExportOverwriteConfirm"),
      cancelLabel: common("Cancel"),
    },
  }
}

/**
 * A name for the chooser to open on. Where the name is really settled is the chooser itself, and
 * the host holds the written file to the grant rather than to anything sent with it, so this only
 * has to be something a file system will take: the item's own title when one thing is going out,
 * and a plain fallback when several are.
 */
export function exportFileName(title: string | null, fallback: string, extension: string): string {
  const stem = (title ?? "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/^\.+|\.+$/g, "")
    .trim()
  return `${stem || fallback}${extension}`
}

/** Where exports have gone before, and whether a chooser can be raised at all. */
export interface ExportFolders {
  readonly available: boolean
  readonly folders: string[]
}

export function fetchExportFolders(): Promise<ExportFolders> {
  return apiFetch<ExportFolders>("/app/export-folders")
}

interface SaveTarget {
  available: boolean
  path: string | null
  grant: string | null
  confirmOverwrite: boolean
}

/**
 * Writes a blob the caller already holds, which is the two mind map pictures and nothing else:
 * they are drawn in the renderer, so the bytes exist nowhere the host can reach.
 *
 * Throws {@link ApiError} when the host refused the destination or the write failed, so a caller
 * that reports failures at all reports a real reason. Dismissing the chooser is not one of those:
 * it comes back as `cancelled`.
 */
export async function saveExport(blob: Blob, request: ExportRequest): Promise<ExportOutcome> {
  const target = await chooseExportTarget(request)
  if (target.status !== "chosen") {
    if (target.status === "unavailable") saveBlob(blob, request.fileName)
    return target.outcome
  }

  // Multipart rather than JSON so the bytes travel as themselves. Base64 would inflate a large
  // picture by a third and put a string that size through a parser for no reason. The grant names
  // the destination; nothing the page could say does.
  const form = new FormData()
  form.append("grant", target.grant)
  form.append("file", blob, request.fileName)

  const saved = await apiFetch<{ path: string }>("/app/export-file", { method: "POST", body: form })
  return { status: "saved", path: saved.path }
}

/**
 * Saves a file the host produces, by settling the destination first and handing the grant to the
 * route that makes it. The bytes go straight from the exporter to the chosen path.
 *
 * @param send Runs the export. The grant is null when there is no window to choose with, and then
 *   the route answers with the file itself for the browser to take.
 */
export async function saveServerExport(
  request: ExportRequest,
  send: (grant: string | null) => Promise<Response>,
  settled?: ChosenTarget | null,
): Promise<ExportOutcome> {
  const target = settled ?? (await chooseExportTarget(request))

  if (target.status === "unavailable") {
    const response = await ok(await send(null))
    const disposition = response.headers.get("Content-Disposition")
    saveBlob(await response.blob(), disposition ? fileNameFromDisposition(disposition) : request.fileName)
    return { status: "downloaded" }
  }

  if (target.status !== "chosen") return target.outcome

  let response: Response
  try {
    response = await ok(await send(target.grant))
  } catch (error) {
    // A destination settled minutes ago while the dialog sat open. The grant lapsing is not a
    // failure to report, it is a question to ask again, so the chooser comes back up once.
    if (!settled || !(error instanceof ApiError) || error.code !== "unknown_grant") throw error
    return saveServerExport(request, send)
  }

  const saved = (await response.json()) as { path: string }
  return { status: "saved", path: saved.path }
}

/**
 * Puts the outcome of a save in front of the user, and answers whether anything happened.
 *
 * False means the chooser was dismissed, which is a decision rather than a result: a dialog that
 * closed itself would read as "done", and saying anything at all would be a claim about a file that
 * does not exist. So the caller stays where it is.
 */
export function announceExport(
  outcome: ExportOutcome,
  strings: { readonly title: string; readonly downloaded: string },
): boolean {
  const description = exportReport(outcome, strings.downloaded)
  if (description === null) return false

  toast.success(strings.title, { description })
  return true
}

/**
 * What to put under an "Export complete" toast, or null when there is nothing to say because
 * nothing happened. The one place that decides, so no dialog can claim a file it did not get.
 */
function exportReport(outcome: ExportOutcome, downloadedText: string): string | null {
  switch (outcome.status) {
    case "saved":
      return outcome.path
    case "downloaded":
      return downloadedText
    case "cancelled":
      return null
  }
}

/** A request to an export route that answers with a file, carrying the token the API requires. */
export function exportRequest(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  const token = apiToken()
  if (token) headers.set("Authorization", `Bearer ${token}`)
  return fetch(`/api${path}`, { ...init, headers })
}

export type ChosenTarget =
  /** The path is for a dialog that names the destination before it writes to it. */
  | { status: "chosen"; grant: string; path: string }
  | { status: "unavailable"; outcome: ExportOutcome }
  | { status: "declined"; outcome: ExportOutcome }

/**
 * Raises the chooser and, when the name gained an extension, asks before replacing anything.
 *
 * Public because a dialog that shows where the file will go has to settle that before it writes
 * one. What comes back is handed to {@link saveServerExport}, which then writes without asking
 * again.
 */
export async function chooseExportTarget(request: ExportRequest): Promise<ChosenTarget> {
  const target = await apiFetch<SaveTarget>("/app/export-file/target", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: request.dialogTitle, fileName: request.fileName }),
  })

  // No window means a browser tab against the dev server, where the page has no say in where a
  // file lands and the browser's own download is both the only answer and a working one.
  if (!target.available) return { status: "unavailable", outcome: { status: "downloaded" } }
  if (!target.path || !target.grant) return { status: "declined", outcome: { status: "cancelled" } }

  // The chooser confirmed the name that was typed. When the host had to append the extension, the
  // file about to be replaced is one nobody was asked about, so it gets asked about here.
  if (target.confirmOverwrite) {
    const replace = await dialog.confirm({
      title: request.overwrite.title,
      message: request.overwrite.message.replace("{0}", target.path),
      destructive: true,
      confirmLabel: request.overwrite.confirmLabel,
      cancelLabel: request.overwrite.cancelLabel,
    })
    // The grant is simply left unspent; it lapses on its own.
    if (!replace) return { status: "declined", outcome: { status: "cancelled" } }
  }

  return { status: "chosen", grant: target.grant, path: target.path }
}

/**
 * The route answers failures as JSON even when success is a file, so an error body is still worth
 * reading for the message it carries.
 */
async function ok(response: Response): Promise<Response> {
  if (response.ok) return response

  const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null
  throw new ApiError(
    body?.message ?? body?.error ?? response.statusText ?? `Request failed with status ${response.status}`,
    response.status,
    body?.error,
  )
}

/**
 * The filename from a Content-Disposition header. Prefers the RFC 5987 `filename*` form, which is
 * the only one that survives a deck named in a non-Latin script.
 */
function fileNameFromDisposition(header: string | null): string {
  if (!header) return "download"

  const encoded = /(?:^|;)\s*filename\*=(?:UTF-8|utf-8)''([^;]+)/i.exec(header)
  if (encoded?.[1]) {
    try {
      return decodeURIComponent(encoded[1])
    } catch {
      // A malformed encoding is not worth failing the export over, so fall through to the plain
      // form, and to the generic name if that is missing too.
    }
  }

  // Anchored to a parameter boundary so it cannot match the "filename" inside "filename*=" and hand
  // back that parameter's encoded value. This branch exists to be the safe fallback.
  const plain = /(?:^|;)\s*filename\s*=\s*"?([^";]+)"?/i.exec(header)
  return plain?.[1]?.trim() || "download"
}

/**
 * The browser's own download, for the one case with no host window behind it.
 *
 * Sound where it is used: with no embedder handling the download, WebKitGTK writes to the user's
 * downloads folder just as Chromium does, so the file does arrive. It stays private because it is
 * the version that cannot say where, which makes it unusable anywhere an outcome is reported. The
 * only way in is a save that asked the host whether a chooser exists first.
 */
function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  // Firefox only honours a click on a link that is in the document.
  document.body.append(link)
  link.click()
  link.remove()
  // Revoking synchronously can cancel the download in some engines; a task later is enough.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
