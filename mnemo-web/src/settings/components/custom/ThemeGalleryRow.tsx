import type { ReactNode } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { THEMES, type ThemeSurfaces } from "@/lib/themes"
import { cn } from "@/lib/utils"
import { useThemeStore } from "@/stores/theme"

import { Block } from "../kit"

/**
 * The theme picker.
 *
 * The catalog is client-owned. It used to come from GET /themes so the web UI and the desktop app
 * agreed, but the two no longer share a palette: a theme here is a block of CSS tokens in this
 * bundle, so the only build that can say which themes exist is this one. Asking the server would
 * list themes nothing is styled for.
 */
export function ThemeGalleryRow({
  title,
  description,
  divider,
}: {
  title: string
  description?: string
  divider: boolean
}) {
  const t = useT()
  const preference = useThemeStore((s) => s.preference)
  const setPreference = useThemeStore((s) => s.setPreference)

  return (
    <div className={cn(divider && "border-b border-line-soft")}>
      {/* A block, not a row: three preview cards do not belong squeezed into the control
          column beside their own label. */}
      <Block label={title} description={description}>
        <div className="grid grid-cols-3 gap-2.5">
          {THEMES.map((option) => (
            <Card
              key={option.id}
              name={option.name}
              note={option.description}
              selected={preference === option.id}
              onSelect={() => setPreference(option.id)}
            >
              <Preview surfaces={option.surfaces} />
            </Card>
          ))}

          <Card
            name={t("Settings", "ThemeSystem")}
            note={t("Settings", "ThemeSystemNote")}
            selected={preference === "system"}
            onSelect={() => setPreference("system")}
          >
            <SystemPreview />
          </Card>
        </div>
      </Block>
    </div>
  )
}

/**
 * A miniature of the app rather than a strip of swatches. You pick a theme to change how
 * the application looks, so the card shows the application: a rail, a hairline, a page
 * with something written on it.
 */
function Preview({ surfaces }: { surfaces: ThemeSurfaces }) {
  return (
    <div className="flex h-[58px] overflow-hidden rounded-md" style={{ background: surfaces.canvas }}>
      <div
        className="flex w-[26px] shrink-0 flex-col gap-[5px] p-[6px]"
        style={{ background: surfaces.frame }}
      >
        <span className="h-[4px] w-[13px] rounded-full" style={{ background: surfaces.ink, opacity: 0.75 }} />
        <span className="h-[3px] w-full rounded-full" style={{ background: surfaces.ink, opacity: 0.22 }} />
        <span className="h-[3px] w-[11px] rounded-full" style={{ background: surfaces.ink, opacity: 0.22 }} />
        <span className="h-[3px] w-full rounded-full" style={{ background: surfaces.ink, opacity: 0.22 }} />
      </div>
      <div className="flex flex-1 flex-col gap-[5px] border-l p-[7px]" style={{ borderColor: surfaces.line }}>
        <span className="h-[5px] w-[34px] rounded-full" style={{ background: surfaces.ink, opacity: 0.85 }} />
        <span className="h-[3px] w-full rounded-full" style={{ background: surfaces.ink, opacity: 0.28 }} />
        <span className="h-[3px] w-full rounded-full" style={{ background: surfaces.ink, opacity: 0.28 }} />
        <span className="h-[3px] w-[60%] rounded-full" style={{ background: surfaces.ink, opacity: 0.28 }} />
      </div>
    </div>
  )
}

/** Both previews, split on the diagonal, because the answer is whichever one the OS says. */
function SystemPreview() {
  const [light, dark] = THEMES

  return (
    <div className="relative h-[58px] overflow-hidden rounded-md">
      <div className="absolute inset-0">
        <Preview surfaces={light.surfaces} />
      </div>
      <div className="absolute inset-0" style={{ clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}>
        <Preview surfaces={dark.surfaces} />
      </div>
      <AppIcon
        name="monitor"
        size={14}
        strokeWidth={1.8}
        // Sits on the dark half, so it takes that theme's ink rather than the page's.
        className="absolute bottom-1.5 right-1.5 text-[oklch(0.955_0.003_260)]"
      />
    </div>
  )
}

function Card({
  selected,
  onSelect,
  name,
  note,
  children,
}: {
  selected: boolean
  onSelect: () => void
  name: string
  note: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "rounded-xl p-1.5 text-left transition-shadow",
        // Selection reads as contrast, the way the buttons and the active sidebar row do.
        // An orange ring here would be the fourth different job the accent is doing.
        selected
          ? "shadow-[0_0_0_1.5px_var(--solid)]"
          : "shadow-[0_0_0_1px_var(--line-soft)] hover:shadow-[0_0_0_1px_var(--line)]",
      )}
      style={{ transitionDuration: "var(--duration-fast)" }}
    >
      {children}
      <span className="mt-1.5 flex items-center gap-1.5 px-0.5 pb-0.5">
        <span className="flex-1 truncate text-[12.5px] font-medium text-ink">{name}</span>
        {selected ? (
          <span className="flex size-[14px] shrink-0 items-center justify-center rounded-full bg-solid">
            <AppIcon name="check" size={9} strokeWidth={3} className="text-solid-fg" />
          </span>
        ) : null}
      </span>
      <span className="block truncate px-0.5 pb-0.5 text-[11.5px] text-ink-3">{note}</span>
    </button>
  )
}
