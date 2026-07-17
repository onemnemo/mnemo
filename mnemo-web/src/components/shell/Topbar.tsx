import { Bell, PanelLeft, Search } from "lucide-react"

import { ThemeSwitcher } from "@/components/shell/ThemeSwitcher"

interface TopbarProps {
  title: string
  onToggleSidebar: () => void
}

export function Topbar({ title, onToggleSidebar }: TopbarProps) {
  return (
    <header
      className="flex shrink-0 items-center gap-3 border-b p-[var(--topbar-inset)]"
      style={{ height: "var(--topbar-height)" }}
    >
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label="Toggle sidebar"
        className="grid size-7 place-items-center rounded-md text-text-tertiary transition-colors hover:bg-[var(--topbar-button-background-hover)] hover:text-text-primary"
      >
        <PanelLeft className="size-5" aria-hidden />
      </button>

      <span className="text-body-small font-medium text-foreground">{title}</span>

      <div className="ml-auto flex items-center gap-2">
        {/* Search is a placeholder until the global-search overlay lands. */}
        <button
          type="button"
          className="flex items-center gap-2 rounded-md border bg-[var(--search-bar-background)] px-2.5 py-1 text-caption text-text-tertiary transition-colors hover:text-text-primary"
          style={{ width: "var(--topbar-search-width)" }}
        >
          <Search className="size-4" aria-hidden />
          <span>Search</span>
          <kbd className="ml-auto rounded bg-[var(--search-bar-shortcut-background)] px-1.5 py-0.5 text-micro">Ctrl K</kbd>
        </button>

        <ThemeSwitcher />

        <button
          type="button"
          aria-label="Notifications"
          className="grid size-7 place-items-center rounded-md text-text-tertiary transition-colors hover:bg-[var(--topbar-button-background-hover)] hover:text-text-primary"
        >
          <Bell className="size-5" aria-hidden />
        </button>
      </div>
    </header>
  )
}
