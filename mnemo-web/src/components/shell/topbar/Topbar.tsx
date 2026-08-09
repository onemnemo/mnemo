import { WindowControls } from "@/components/shell/chrome/WindowControls"
import { Breadcrumbs } from "@/components/shell/topbar/Breadcrumbs"
import { FrameButton } from "@/components/shell/topbar/FrameButton"
import { NotificationBell } from "@/components/shell/topbar/NotificationBell"
import { useT } from "@/i18n/useT"
import { useShortcutLabel } from "@/keybinds/store"
import { onTitlebarPointerDown } from "@/lib/window"
import type { Crumb } from "@/nav/trail"
import { useSettingValue } from "@/settings/store"
import { usePaletteStore } from "@/stores/palette"
import { useSomaStore } from "@/stores/soma"

interface TopbarProps {
  crumbs: Crumb[]
  collapsed: boolean
  onExpand: () => void
}

/**
 * Row one of the frame: where you are, plus the handful of controls that are
 * global rather than module-specific.
 *
 * The window is chromeless, so this is also the titlebar. Pressing anywhere that
 * is not a control moves the window, and a double press maximizes it.
 *
 * Two mechanisms, one behind the other. `drag-region` is a native hit test where the
 * platform supports one, which is what makes the drag feel like a window rather than
 * like something following the mouse. Where it does not, the pointerdown handler asks
 * the host to start the drag instead. Only one of them is ever live, because a native
 * region never lets the press reach the page.
 */
export function Topbar({ crumbs, collapsed, onExpand }: TopbarProps) {
  const t = useT()
  const aiEnabled = useSettingValue("AI.EnableAssistant", false)
  const dockOpen = useSomaStore((s) => s.dockOpen)
  const toggleDock = useSomaStore((s) => s.toggleDock)
  const togglePalette = usePaletteStore((s) => s.toggle)

  const searchShortcut = useShortcutLabel("global.search")
  const assistantShortcut = useShortcutLabel("global.assistant")

  return (
    <header
      onPointerDown={onTitlebarPointerDown}
      className="drag-region flex shrink-0 items-stretch gap-2 border-b border-line-soft pl-3 pr-0"
      style={{ height: "var(--topbar-h)" }}
    >
      {collapsed && (
        <FrameButton
          icon="panel-left"
          label={t("Sidebar", "ExpandSidebar")}
          onClick={onExpand}
          className="size-7"
        />
      )}

      <Breadcrumbs crumbs={crumbs} />

      <div className="flex shrink-0 items-center gap-1 pr-1">
        {/* Search opens a centred overlay, so this is a button and not a field. A
            wide pill reads as typable, which would be a small lie. */}
        <FrameButton
          icon="search"
          label={t("Topbar", "SearchLabel")}
          hint={hint(t("Topbar", "SearchLabel"), searchShortcut)}
          onClick={togglePalette}
        />

        {aiEnabled && (
          <FrameButton
            icon="orbit"
            label="Soma"
            hint={hint("Soma", assistantShortcut)}
            pressed={dockOpen}
            onClick={toggleDock}
          />
        )}

        <NotificationBell />
      </div>

      {/* A direct child of the header so it can stretch to the full bar height:
          nested inside a centred row it collapses to content height, which is what
          makes a hover fill read as a thin strip and gives the chrome away. */}
      <WindowControls />
    </header>
  )
}

function hint(label: string, shortcut: string | null | undefined): string {
  return shortcut ? `${label} · ${shortcut}` : label
}
