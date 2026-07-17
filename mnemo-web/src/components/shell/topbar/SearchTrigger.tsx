import { AppIcon } from "@/components/icon/AppIcon"

// Opens the global-search overlay (wired when that overlay lands). Matches the
// reference search chrome: quiet field with a shortcut pill.
export function SearchTrigger() {
  return (
    <button
      type="button"
      title="Search"
      className="flex h-7 items-center gap-2 rounded-md border border-[var(--search-bar-border)] bg-[var(--search-bar-background)] px-2 transition-colors hover:bg-[var(--search-bar-hover)]"
      style={{ width: "var(--topbar-search-width)" }}
    >
      <AppIcon name="common/search" size={12} className="text-text-faded" />
      <span className="text-[12.5px] text-[var(--search-bar-text)]">Search</span>
      <span className="ml-auto rounded border border-[var(--search-bar-border)] bg-[var(--search-bar-shortcut-background)] px-1.5 py-px font-mono text-[10px] text-text-faded">
        Ctrl K
      </span>
    </button>
  )
}
