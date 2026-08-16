import { ApiError, apiSend } from "@/api/client"

/** A directory the host will show. The name is the whole request; the host owns the path. */
export type HostFolder = "logs" | "data"

/** Why a folder did not open, or null when it did. */
export type FolderOpenFailure = "missing" | "failed"

/**
 * Asks the host to show one of its own directories in the system file manager.
 *
 * Deliberately not `openExternally` with a `file:` URL: that endpoint takes a string
 * from here and hands it to the shell, and its scheme allowlist exists to keep local
 * paths out of it. This sends a name instead, and the host resolves the directory from
 * the locations it already knows, so nothing on this side can name a path at all.
 */
export async function openHostFolder(target: HostFolder): Promise<FolderOpenFailure | null> {
  try {
    await apiSend("/app/open-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
    })
    return null
  } catch (error) {
    // A log directory exists only once something has been logged, which is a normal
    // state worth telling the user apart from a shell that refused. Matched on the
    // host's code and not on 404 alone: a host predating this route answers 404 as
    // well, and that user needs a restart rather than an explanation of empty logs.
    return error instanceof ApiError && error.code === "missing_directory" ? "missing" : "failed"
  }
}
