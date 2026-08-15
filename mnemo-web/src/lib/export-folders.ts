import { apiFetch } from "@/api/client"

/**
 * Where the app writes files it saves for you, and whether it can offer to browse for somewhere
 * else. Mnemo.Host/Lifecycle/ExportFolders.cs is the other half.
 *
 * A folder is remembered rather than configured: it is a decision made once and then repeated, so
 * the last one used is a better default than anything the app could pick.
 */
export interface ExportFolders {
  /** False without a native window, which is the dev server in a browser tab and the test host. */
  available: boolean
  /** Most recent first. Never empty: an untouched profile gets one sensible suggestion. */
  folders: string[]
}

export function fetchExportFolders(): Promise<ExportFolders> {
  return apiFetch<ExportFolders>("/app/export-folders")
}

/**
 * Raises the operating system's folder chooser and resolves to what was chosen, or to null if it
 * was dismissed. The title is passed in because the translations live here, not in the host.
 */
export async function pickExportFolder(title: string, startPath?: string): Promise<string | null> {
  const answer = await apiFetch<{ path: string | null }>("/app/export-folders/pick", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, startPath: startPath ?? null }),
  })
  return answer.path
}

/**
 * The recognisable end of a path: "Mnemo", "Desktop", "Backups".
 *
 * What comes before it is `C:\Users\<you>` on every row of a recents list, which is the same
 * eleven characters repeated and no help at all. The full path stays on the row's value, for the
 * case where two folders share a name.
 */
export function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}
