import { useEffect, useMemo, useRef, useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { EMOJI_CATEGORY_KEY, RECENT_CATEGORY, type EmojiCategoryId } from "@/emoji/categories"
import { orderCategories } from "@/emoji/context"
import { loadEmojiIndex } from "@/emoji/dataset"
import { readRecentEmoji, rememberEmoji } from "@/emoji/recent"
import { searchEmoji } from "@/emoji/search"
import type { EmojiEntry, EmojiIndex } from "@/emoji/types"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

interface Section {
  id: string
  label: string
  entries: readonly EmojiEntry[]
}

/**
 * The picker body: a search box, a clear button, and every category stacked in one
 * scroller under its own heading.
 *
 * Stacked rather than tabbed so the whole vocabulary is one scroll away. Searching
 * collapses it to a single results section, since a heading per category would
 * imply the results are grouped when they are ranked.
 *
 * Everything it knows about emoji comes from the index it loads at runtime, so
 * updating the emoji packages changes what this renders without touching it.
 */
export function EmojiPicker({
  value,
  context = "",
  onSelect,
  onClear,
}: {
  value: string | null
  /** What the icon is for, usually a name. Only reorders the sections. */
  context?: string
  onSelect: (char: string) => void
  onClear: () => void
}) {
  const t = useT()
  const tr = (key: string) => t("EmojiPicker", key)

  const [index, setIndex] = useState<EmojiIndex | null>(null)
  const [query, setQuery] = useState("")
  const [recent, setRecent] = useState<readonly string[]>(() => readRecentEmoji())

  useEffect(() => {
    let live = true
    void loadEmojiIndex().then((loaded) => {
      if (live) setIndex(loaded)
    })
    return () => {
      live = false
    }
  }, [])

  const sections = useMemo<Section[]>(() => {
    if (!index) return []

    const needle = query.trim()
    if (needle) {
      const entries = searchEmoji(index, needle)
      return entries.length > 0 ? [{ id: "results", label: tr("Results"), entries }] : []
    }

    // Recent only earns a heading once there is something under it.
    const available: EmojiCategoryId[] = recent.length > 0 ? [RECENT_CATEGORY] : []
    for (const [id, entries] of index.byCategory) {
      if (id !== RECENT_CATEGORY && entries.length > 0) available.push(id)
    }

    return orderCategories(context, available)
      .map((id) => ({
        id,
        label: tr(EMOJI_CATEGORY_KEY[id]),
        entries: id === RECENT_CATEGORY ? resolve(index, recent) : (index.byCategory.get(id) ?? []),
      }))
      .filter((section) => section.entries.length > 0)
    // tr is rebuilt whenever the language bundle changes, which is the only time
    // the labels need recomputing, so it is safe to leave out of the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, query, recent, context, t])

  const pick = (char: string) => {
    setRecent(rememberEmoji(char))
    onSelect(char)
  }

  return (
    <div className="w-[292px] p-2">
      <div className="flex items-center gap-1.5">
        <div className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-canvas-sunken px-2 focus-within:shadow-[0_0_0_1px_var(--line)]">
          <AppIcon name="common/search" size={14} strokeWidth={1.7} className="shrink-0 text-ink-icon" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tr("SearchPlaceholder")}
            aria-label={tr("SearchPlaceholder")}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-3 focus:outline-none"
          />
        </div>

        {/* An icon is optional, so "none" has to be one click rather than
            something you go hunting for. */}
        <button
          type="button"
          onClick={onClear}
          disabled={value === null}
          title={tr("NoIcon")}
          aria-label={tr("NoIcon")}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-frame-hover hover:text-ink disabled:pointer-events-none disabled:opacity-35"
        >
          <AppIcon name="common/x" size={16} strokeWidth={1.8} />
        </button>
      </div>

      <div data-emoji-scroll className="scroll-thin mt-2 max-h-[232px] overflow-y-auto">
        {index !== null && sections.length === 0 ? (
          <p className="px-1 py-6 text-center text-[12.5px] text-ink-3">{tr("NoMatchFormat").replace("{0}", query.trim())}</p>
        ) : null}

        {sections.map((section) => (
          <Section key={section.id} section={section} value={value} onPick={pick} />
        ))}
      </div>
    </div>
  )
}

/** A 32px cell plus the 2px grid gap, which is what one row of eight costs. */
const ROW_HEIGHT = 34

/**
 * One heading and its grid, where the grid is only built once it is near the
 * viewport.
 *
 * Every category stacked is around two thousand buttons, and building them all up
 * front cost more than a popover is allowed to. The placeholder reserves the exact
 * height the grid will take, so nothing shifts when it arrives and the scrollbar
 * tells the truth before it does.
 */
function Section({
  section,
  value,
  onPick,
}: {
  section: Section
  value: string | null
  onPick: (char: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element || shown) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setShown(true)
      },
      // Well ahead of the scroll, so a fast flick does not land on a placeholder.
      { root: element.closest("[data-emoji-scroll]"), rootMargin: "400px" },
    )

    observer.observe(element)
    return () => observer.disconnect()
  }, [shown])

  const rows = Math.ceil(section.entries.length / 8)

  return (
    <div ref={ref} className="mb-1">
      <p className="px-1 pt-1 pb-1 text-[11.5px] text-ink-3">{section.label}</p>
      {shown ? (
        <div className="grid grid-cols-8 gap-0.5">
          {section.entries.map((entry) => (
            <button
              key={entry.char}
              type="button"
              title={entry.name}
              aria-label={entry.name}
              onClick={() => onPick(entry.char)}
              // Full-width rather than a fixed 32px: eight fixed cells plus the
              // scrollbar overflow the popover by a hair, and the resulting
              // horizontal scrollbar is worse than a pixel of cell width.
              className={cn(
                "flex h-8 w-full items-center justify-center rounded-md text-[17px] leading-none transition-colors",
                entry.char === value ? "bg-frame-active" : "hover:bg-frame-hover",
              )}
            >
              {entry.char}
            </button>
          ))}
        </div>
      ) : (
        <div style={{ height: rows * ROW_HEIGHT - 2 }} />
      )}
    </div>
  )
}

/** Recent is stored as bare characters, so it has to be looked back up to render. */
function resolve(index: EmojiIndex, chars: readonly string[]): readonly EmojiEntry[] {
  return chars.map((char) => index.byChar.get(char)).filter((entry): entry is EmojiEntry => entry !== undefined)
}
