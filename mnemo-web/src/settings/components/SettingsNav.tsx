import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"
import { useTrashCountQuery } from "@/trash/api"

import { useAiEnabled } from "../aiEnabled"
import { DEFAULT_PROFILE_PICTURE } from "../assets"
import { useDeveloperGateTap } from "../developerGate"
import { UNTRANSLATED_CATEGORY_TITLES } from "../schema"
import { useSettingValue } from "../store"
import { useAvatarUrl } from "../useAvatarUrl"
import type { SettingsCategory, SettingsSection } from "../types"

const SECTION_LABELS: Record<SettingsSection, string> = {
  you: "NavYou",
  app: "NavApp",
  modules: "NavModules",
  advanced: "NavAdvanced",
}

const SECTION_ORDER: SettingsSection[] = ["you", "app", "modules", "advanced"]

/**
 * The settings rail: search, then categories grouped by section.
 *
 * A panel with its own scroll rather than a column in the page, so a long category
 * list and a long page scroll independently and the rail never runs out from under
 * the page it belongs to.
 */
export function SettingsNav({
  categories,
  selectedId,
  onSelect,
  query,
  onQueryChange,
}: {
  categories: SettingsCategory[]
  selectedId: string
  onSelect: (id: string) => void
  query: string
  onQueryChange: (next: string) => void
}) {
  const t = useT()
  const tapTitle = useDeveloperGateTap()
  // Asked once here rather than inside every row: one row wants it and the rest would each be
  // subscribing to a count they never draw.
  const trashCount = useTrashCountQuery().data?.count ?? 0

  return (
    <div className="flex w-[236px] shrink-0 flex-col border-r border-line-soft">
      <div className="px-4 pb-3 pt-5">
        <button
          type="button"
          onClick={tapTitle}
          // The gate is meant to be invisible: this reads as the page heading, and nothing about
          // it invites the seven taps that unlock developer mode.
          className="cursor-default text-left text-[15px] font-semibold tracking-[-0.01em] text-ink"
        >
          {t("Settings", "Title")}
        </button>

        <div className="mt-3 flex h-8 items-center gap-1.5 rounded-lg bg-canvas-sunken px-2 focus-within:shadow-[0_0_0_1px_var(--line)]">
          <AppIcon name="search" size={14} strokeWidth={1.7} className="shrink-0 text-ink-icon" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t("Settings", "SearchPlaceholder")}
            aria-label={t("Settings", "SearchPlaceholder")}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
          />
        </div>
      </div>

      <nav className="scroll-thin flex-1 overflow-y-auto px-2 pb-4">
        {SECTION_ORDER.map((section, index) => {
          const inSection = categories.filter((category) => category.section === section)
          if (inSection.length === 0) return null

          return (
            <div key={section} className={cn(index > 0 && "mt-4")}>
              <p className="px-2 pb-1 pt-1 text-[12px] text-ink-3">{t("Settings", SECTION_LABELS[section])}</p>
              <div className="space-y-px">
                {inSection.map((category) => (
                  <NavItem
                    key={category.id}
                    category={category}
                    selected={category.id === selectedId}
                    trashCount={trashCount}
                    onSelect={() => onSelect(category.id)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </nav>
    </div>
  )
}

function NavItem({
  category,
  selected,
  trashCount,
  onSelect,
}: {
  category: SettingsCategory
  selected: boolean
  /** How much the trash is holding, for the one row that reports it. */
  trashCount: number
  onSelect: () => void
}) {
  const t = useT()
  const aiEnabled = useAiEnabled()
  const avatar = useAvatarUrl(useSettingValue("User.ProfilePicture", DEFAULT_PROFILE_PICTURE))

  const title = UNTRANSLATED_CATEGORY_TITLES[category.id] ?? t("Settings", category.title)
  // Two rows report their own state so it is visible without opening them: the AI page when its
  // master switch is off, and the trash when it is holding something recoverable.
  const statusTag =
    category.id === "AITools" && !aiEnabled
      ? t("Settings", "StatusOff")
      : category.id === "Trash" && trashCount > 0
        ? String(trashCount)
        : null

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "page" : undefined}
      className={cn(
        "flex h-[30px] w-full items-center gap-2.5 rounded-md px-2 text-[13.5px] transition-colors",
        selected ? "bg-frame-active font-medium text-ink" : "text-ink-2 hover:bg-frame-hover hover:text-ink",
      )}
      style={{ transitionDuration: "var(--duration-fast)" }}
    >
      {/* Profile wears the actual profile picture rather than a generic mark: it is the one
          category that is about a specific person, and the picture says so faster than any glyph. */}
      {category.id === "Profile" ? (
        <img src={avatar ?? undefined} alt="" className="size-4 shrink-0 rounded-full object-cover" />
      ) : (
        <AppIcon name={category.icon} size={16} strokeWidth={1.5} className={cn(!selected && "text-ink-icon")} />
      )}
      <span className="min-w-0 flex-1 truncate text-left">{title}</span>
      {statusTag ? (
        <span className="shrink-0 rounded-pill bg-canvas-sunken px-1.5 py-px text-[10px] text-ink-3">{statusTag}</span>
      ) : null}
    </button>
  )
}
