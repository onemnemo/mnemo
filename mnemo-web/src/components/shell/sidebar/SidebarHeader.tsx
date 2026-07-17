import { AppIcon } from "@/components/icon/AppIcon"
import { IconButton } from "@/components/ui/icon-button"

interface SidebarHeaderProps {
  collapsed: boolean
  onToggle: () => void
}

// Expanded: wordmark + collapse chevron. Collapsed: glyph mark stacked over the
// expand chevron. Logo tints to SidebarLogo (the brand accent) via currentColor.
export function SidebarHeader({ collapsed, onToggle }: SidebarHeaderProps) {
  if (collapsed) {
    return (
      <div className="mb-5 flex flex-col items-center gap-2.5">
        <AppIcon name="branding/logo-icon" size={24} className="text-[var(--sidebar-logo)]" />
        <IconButton icon="common/chevron-right" label="Expand sidebar" onClick={onToggle} />
      </div>
    )
  }

  return (
    <div className="mx-2 mb-3 mt-1 flex items-center justify-between">
      <AppIcon name="branding/logo-full" width={90} height={18} className="text-[var(--sidebar-logo)]" />
      <IconButton icon="common/chevron-left" label="Collapse sidebar" onClick={onToggle} />
    </div>
  )
}
