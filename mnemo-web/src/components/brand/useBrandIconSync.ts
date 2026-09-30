import { useEffect } from "react"

import { apiFetch, apiSend } from "@/api/client"
import { DEFAULT_ACCENT, resolveAccent } from "@/lib/accents"
import { iconKey, lightAccentFill, renderIconFile, type IconFormat } from "@/lib/brand/app-icon"
import { DEFAULT_LOGO, type LogoId } from "@/lib/brand/marks"
import { useSettingValue } from "@/settings/store"
import { ACCENT_SETTING_KEY } from "@/stores/accent"

import { useLogo } from "./useLogo"

interface HostIcon {
  key: string | null
  /** Null when there is no native window to give an icon to. */
  format: IconFormat | null
}

/**
 * Keeps the window, taskbar and Dock icon on the chosen logo. The host keeps the last
 * render and applies it at the next start before the window shows; this only sends a
 * new one when the host's copy is for a different choice. The default logo needs no
 * render: the host falls back to the icon it ships with.
 */
export function useBrandIconSync(): void {
  const logo = useLogo()
  const accent = resolveAccent(useSettingValue(ACCENT_SETTING_KEY, DEFAULT_ACCENT))

  useEffect(() => requestSync(logo, accent), [logo, accent])
}

// Module state, not refs: syncs must run one at a time across remounts (StrictMode
// mounts twice), or two requests can land at the host in the wrong order.
let queue: Promise<void> = Promise.resolve()
let wanted: { logo: LogoId; accent: string } | null = null
let known: HostIcon | null = null

function requestSync(logo: LogoId, accent: string): void {
  wanted = { logo, accent }
  queue = queue.then(runLatest)
}

async function runLatest(): Promise<void> {
  const target = wanted
  if (!target) return
  wanted = null
  try {
    known ??= await apiFetch<HostIcon>("/app/brand-icon")
    if (!known.format || wanted) return
    known = { ...known, key: await sync(known, known.format, target.logo, target.accent) }
  } catch {
    // The icon is cosmetic. Forget what the host holds so the next change asks again.
    known = null
  }
}

/** Returns the key the host holds afterwards. */
async function sync(state: HostIcon, format: IconFormat, logo: LogoId, accent: string): Promise<string | null> {
  if (logo === DEFAULT_LOGO) {
    if (state.key !== null) await apiSend("/app/brand-icon", { method: "DELETE" })
    return null
  }

  const key = iconKey(logo, accent)
  if (state.key === key) return key
  const file = await renderIconFile(format, logo, lightAccentFill(accent))
  await apiSend("/app/brand-icon", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, data: toBase64(file) }),
  })
  return key
}

function toBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** Test seam: forget module state between cases. */
export function resetBrandIconSync(): void {
  queue = Promise.resolve()
  wanted = null
  known = null
}
