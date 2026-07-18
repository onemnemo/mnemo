import { ApiError, apiToken } from "./client"

// Saving a file the API produced. A plain <a download href="/api/..."> cannot carry the bearer
// token, and the export route only exists behind it, so the bytes are fetched with the auth
// header and handed to a synthetic link as a blob instead. Same shape as the problem asset-blob.ts
// solves for <img>, with the other half of it - the name the file lands under - coming back in
// Content-Disposition rather than being guessed here.

/** Fetches a file from the API and saves it under the name the server asked for. */
export async function downloadFromApi(path: string, init?: RequestInit): Promise<void> {
  const headers = new Headers(init?.headers)
  const token = apiToken()
  if (token) headers.set("Authorization", `Bearer ${token}`)

  const response = await fetch(`/api${path}`, { ...init, headers })
  if (!response.ok) {
    // The route answers failures as JSON even though success is a file, so an error body is
    // still worth reading for the adapter's own message.
    const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null
    throw new ApiError(
      body?.message ?? body?.error ?? response.statusText ?? `Request failed with status ${response.status}`,
      response.status,
      body?.error,
    )
  }

  const name = fileNameFromDisposition(response.headers.get("Content-Disposition"))
  saveBlob(await response.blob(), name)
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
      // A malformed encoding is not worth failing the download over - fall through to the plain
      // form, and to the generic name if that is missing too.
    }
  }

  // Anchored to a parameter boundary so it cannot match the "filename" inside "filename*=" and
  // hand back that parameter's encoded value - this branch exists to be the safe fallback.
  const plain = /(?:^|;)\s*filename\s*=\s*"?([^";]+)"?/i.exec(header)
  return plain?.[1]?.trim() || "download"
}

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
