/**
 * Reports the user agent for startup diagnostics. Failure must not interrupt startup.
 */

import { apiSend } from "@/api/client"

export function reportClientInfo(): void {
  void apiSend("/app/client-info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userAgent: navigator.userAgent }),
  }).catch((error: unknown) => {
    // Nothing to recover: the worst case is a launch that logs one fewer boot line.
    console.error("[client-info] could not report to the host", error)
  })
}
