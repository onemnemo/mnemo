import { apiSend } from "@/api/client"

/**
 * Opens a link in the operating system's default browser.
 *
 * Not `window.open`: the shipped window is chromeless and has no tabs, so navigating
 * would replace the application with a web page and leave no way back, and PhotinoX
 * gives the host no hook to intercept a popup with. The host does it instead, and only
 * for http and https.
 *
 * Fire and forget on purpose. Nothing in the UI waits on a browser launching, and a
 * failure is reported to the console rather than surfaced: by the time it is known the
 * user is already looking at whatever did or did not appear in front of them.
 */
export function openExternally(url: string): void {
  void apiSend("/app/open-external", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  }).catch((error: unknown) => {
    console.error("[external] could not open", url, error)
  })
}
