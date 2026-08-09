import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

/**
 * The single home for identity.
 *
 * Still a placeholder mark: the app has no account model, so there is no name or
 * picture to show. It moved out of the topbar because identity belongs at the
 * bottom of the rail with the other things that are about you rather than about
 * what you are looking at.
 */
export function ProfileRow({ collapsed }: { collapsed: boolean }) {
  const t = useT()
  const label = t("Topbar", "ProfileTooltip")

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "flex h-8 w-full items-center rounded-md transition-colors hover:bg-frame-hover",
        collapsed ? "justify-center px-0" : "gap-2.5 px-2",
      )}
      style={{ transitionDuration: "var(--duration-fast)" }}
    >
      <span className="grid size-[18px] shrink-0 place-items-center rounded-full bg-frame-active text-[9px] font-semibold text-ink-2">
        M
      </span>
      {!collapsed && <span className="flex-1 truncate text-left text-[14px] text-ink-2">Mnemo</span>}
    </button>
  )
}
