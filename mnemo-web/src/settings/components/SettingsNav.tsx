import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { assetUrl, DEFAULT_PROFILE_PICTURE } from "../assets"
import { useDeveloperGateTap } from "../developerGate"
import { UNTRANSLATED_CATEGORY_TITLES } from "../schema"
import { useSettingValue } from "../store"
import type { SettingsCategory, SettingsSection } from "../types"

const SECTION_LABELS: Record<SettingsSection, string> = {
  account: "NavAccount",
  app: "NavApp",
  modules: "NavModules",
}

const SECTION_ORDER: SettingsSection[] = ["account", "app", "modules"]

/** The settings rail: search, then categories grouped by section. */
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

  return (
    <nav className="flex w-56 shrink-0 flex-col gap-4">
      <button
        type="button"
        onClick={tapTitle}
        // The gate is meant to be invisible: this reads as the page heading, and
        // nothing about it invites the seven taps that unlock developer mode.
        className="cursor-default text-left text-heading-4 font-semibold text-text-primary"
      >
        {t("Settings", "Title")}
      </button>

      <div className="relative">
        <AppIcon
          name="common/search"
          size={13}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faded"
        />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t("Settings", "SearchPlaceholder")}
          aria-label={t("Settings", "SearchPlaceholder")}
          className={cn(
            "h-[30px] w-full rounded-sm border border-input bg-[var(--search-bar-background,var(--text-control-background))]",
            "pl-7 pr-2 text-body-extra-small text-text-primary outline-none",
            "placeholder:text-[var(--text-control-placeholder-foreground)]",
            "focus:border-[var(--text-control-border-focused)]",
          )}
        />
      </div>

      {SECTION_ORDER.map((section) => {
        const inSection = categories.filter((c) => c.section === section)
        if (inSection.length === 0) return null

        return (
          <div key={section}>
            <div className="mb-1 px-2 text-micro font-semibold uppercase tracking-[1px] text-text-faded">
              {t("Settings", SECTION_LABELS[section])}
            </div>
            <ul className="space-y-0.5">
              {inSection.map((category) => (
                <li key={category.id}>
                  <NavItem
                    category={category}
                    selected={category.id === selectedId}
                    onSelect={() => onSelect(category.id)}
                  />
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}

function NavItem({
  category,
  selected,
  onSelect,
}: {
  category: SettingsCategory
  selected: boolean
  onSelect: () => void
}) {
  const t = useT()
  const aiEnabled = useSettingValue("AI.EnableAssistant", false)
  const avatar = useSettingValue("User.ProfilePicture", DEFAULT_PROFILE_PICTURE)

  const title = UNTRANSLATED_CATEGORY_TITLES[category.id] ?? t("Settings", category.title)
  // The desktop tags the AI page when its master switch is off, so the state is
  // visible without opening it.
  const statusTag = category.id === "AITools" && !aiEnabled ? t("Settings", "StatusOff") : null

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body-small transition-colors",
        selected ? "bg-frame-hover font-medium text-text-primary" : "text-text-secondary hover:bg-frame-hover/60",
      )}
    >
      {category.id === "Account" ? (
        <img
          src={assetUrl(avatar) ?? undefined}
          alt=""
          className="h-4 w-4 shrink-0 rounded-full object-cover"
        />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {statusTag ? (
        <span className="rounded-pill bg-surface-subtle px-1.5 py-px text-micro text-text-tertiary">
          {statusTag}
        </span>
      ) : null}
    </button>
  )
}
