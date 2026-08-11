import { useQuery } from "@tanstack/react-query"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"

import { fetchAppInfo } from "../../api"
import { formatVersion } from "../../version"

/**
 * What the reader is looking at: the mark, the name, and the build.
 *
 * A header rather than a row, so it carries no label column and no divider. The
 * version comes off the same query the updates row uses, so About costs no extra
 * request when both have been opened.
 */
export function AboutIdentityRow() {
  const t = useT()
  const { data } = useQuery({ queryKey: ["app", "info"], queryFn: fetchAppInfo })

  // The platform is dropped rather than guessed at when it is not recognised, so the
  // line never trails a separator with nothing after it.
  const build = [t("Settings", "AboutVersionFormat", { 0: formatVersion(data?.version) }), platformName()]
    .filter(Boolean)
    .join(" · ")

  return (
    <div className="flex items-center gap-4 py-1">
      {/* The mark is 60x50, so a square box would letterbox it. */}
      <AppIcon name="branding/logo-icon" width={48} height={40} className="shrink-0 text-accent" />
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-ink">Mnemo</p>
        <p className="mt-0.5 text-[12.5px] text-ink-3">{build}</p>
      </div>
    </div>
  )
}

/**
 * The operating system as a person would name it.
 *
 * `navigator.userAgent` is the only thing available here, and it is a browser's answer
 * to a question about a desktop app, so an unrecognised one is left out of the line
 * rather than guessed at.
 */
function platformName(): string {
  const agent = navigator.userAgent
  if (agent.includes("Windows")) return "Windows"
  if (agent.includes("Mac OS")) return "macOS"
  if (agent.includes("Linux")) return "Linux"
  return ""
}
