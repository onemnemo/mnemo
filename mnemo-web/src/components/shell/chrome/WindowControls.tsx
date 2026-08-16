import { useEffect, useState } from "react"

import { useT } from "@/i18n/useT"
import { closeWindow, minimizeWindow, onMaximizeChange, toggleMaximizeWindow } from "@/lib/window"

/**
 * Window controls, drawn by us because the window has no OS titlebar.
 *
 * Mnemo puts them on the right on every platform. Drawing our own chrome means
 * the choice is ours to make, and one position everywhere beats a layout that
 * reshuffles itself depending on where the app is running.
 *
 * Order matters more than it looks: Close sits in the window corner, which is
 * where the pointer lands when it is thrown at the edge. On the right that means
 * minimize, maximize, close.
 */
export function WindowControls() {
  const t = useT()
  const [maximized, setMaximized] = useState(false)
  const [hovered, setHovered] = useState(false)

  useEffect(() => onMaximizeChange(setMaximized), [])

  const lights = [
    { key: "minimize", color: "#febc2e", glyph: "−", label: t("Topbar", "MinimizeTooltip"), run: minimizeWindow },
    {
      key: "maximize",
      color: "#28c840",
      glyph: maximized ? "–" : "+",
      label: maximized ? t("Topbar", "RestoreTooltip") : t("Topbar", "MaximizeTooltip"),
      run: toggleMaximizeWindow,
    },
    { key: "close", color: "#ff5f57", glyph: "✕", label: t("Topbar", "CloseTooltip"), run: closeWindow },
  ]

  return (
    <div
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className="flex shrink-0 items-center gap-2 self-center pl-1 pr-3.5"
    >
      {lights.map((light) => (
        <button
          key={light.key}
          type="button"
          aria-label={light.label}
          title={light.label}
          onClick={light.run}
          className="grid size-3 place-items-center rounded-full"
          style={{ backgroundColor: light.color }}
        >
          <span
            className={`text-[7px] font-bold leading-none text-black/55 transition-opacity ${hovered ? "opacity-100" : "opacity-0"}`}
            style={{ transitionDuration: "var(--duration-fast)" }}
            aria-hidden
          >
            {light.glyph}
          </span>
        </button>
      ))}
    </div>
  )
}
