import { NAV_CATEGORIES } from "@/app/routes"
import { AppIcon } from "@/components/icon/AppIcon"
import { NavItem } from "@/components/shell/sidebar/NavItem"
import { useT } from "@/i18n/useT"
import { useShortcutLabel } from "@/keybinds/store"

// Footer: the quick-actions launcher, the flat footer categories (Ecosystem:
// Settings, Assistant), and the version label.
export function SidebarFooter({ activeRoute }: { activeRoute: string }) {
  const t = useT()
  const footerCategories = NAV_CATEGORIES.filter((category) => category.footer)
  const quickActionsShortcut = useShortcutLabel("global.quick-actions")

  return (
    <div className="mt-2 flex flex-col gap-px">
      <button
        type="button"
        className="flex h-[29px] w-full items-center rounded-md px-2 text-navigation text-[var(--navigation-button-foreground)] transition-colors hover:bg-[var(--navigation-button-background-hover)] hover:text-[var(--navigation-button-foreground-hover)]"
      >
        <AppIcon name="sidebar/quick-actions" size={16} className="text-[var(--navigation-button-icon)]" />
        <span className="ml-[9px]">{t("Sidebar", "QuickActions")}</span>
        {quickActionsShortcut && (
          <span className="ml-auto rounded border border-[var(--sidebar-border)] bg-[var(--workspace-background)] px-1.5 py-px font-mono text-[10px] text-text-faded">
            {quickActionsShortcut}
          </span>
        )}
      </button>

      {footerCategories.flatMap((category) =>
        category.items.map((item) => <NavItem key={item.route} item={item} active={activeRoute === item.route} />),
      )}

      <div className="ml-2 mt-2.5 text-body-caption text-[var(--version-text)]">v0.0.0</div>
    </div>
  )
}
