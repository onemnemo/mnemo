import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { useShortcutLabel } from "@/keybinds/store"

// Opens the global-search overlay (wired when that overlay lands). Matches the
// reference search chrome: quiet field with a shortcut pill.
export function SearchTrigger() {
  const t = useT()
  // The pill reflects the real global.search binding from the keybind catalog.
  const shortcut = useShortcutLabel("global.search")
  return (
    <button
      type="button"
      title={t("Topbar", "SearchPlaceholder")}
      className="flex h-7 items-center gap-2 rounded-md border border-[var(--search-bar-border)] bg-[var(--search-bar-background)] px-2 transition-colors hover:bg-[var(--search-bar-hover)]"
      style={{ width: "var(--topbar-search-width)" }}
    >
      <AppIcon name="common/search" size={12} className="text-text-faded" />
      <span className="text-[12.5px] text-[var(--search-bar-text)]">{t("Topbar", "SearchLabel")}</span>
      {shortcut && (
        <span className="ml-auto rounded border border-[var(--search-bar-border)] bg-[var(--search-bar-shortcut-background)] px-1.5 py-px font-mono text-[10px] text-text-faded">
          {shortcut}
        </span>
      )}
    </button>
  )
}
