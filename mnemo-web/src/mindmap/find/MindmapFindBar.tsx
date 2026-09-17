/**
 * The find bar over the map: a field, a count, and the walk. Pinned to the top right of the pane, on
 * the same panel material as the dock, and it owns no search logic; everything here delegates to
 * `useMindmapFind`. This file is chrome and keyboard wiring.
 */

import { useEffect, useRef, type KeyboardEvent } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"

import { FloatBar, Sep, Slot } from "../chrome/bits"
import type { MindmapFind } from "./useMindmapFind"

export function MindmapFindBar({ find }: { find: MindmapFind }) {
  const t = useT()
  const input = useRef<HTMLInputElement>(null)

  // Focus and select on open and on every further ask, so a Ctrl+F from the canvas while the bar
  // is already up lands ready to type over what is there.
  useEffect(() => {
    if (find.open) {
      input.current?.focus()
      input.current?.select()
    }
  }, [find.open, find.opened])

  if (!find.open) {
    return null
  }

  const count =
    find.query.trim().length === 0 ? "0/0" : find.count === 0 ? "0" : `${find.index + 1}/${find.count}`

  // The keys the bar owns are handled here and left to bubble: the route's handler ignores
  // anything typed into a field, and the window keeps the chords the app allows while typing.
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault()
      if (event.shiftKey) {
        find.previous()
      } else {
        find.next()
      }
      return
    }
    if (event.key === "Escape") {
      event.preventDefault()
      find.close()
      return
    }
    if ((event.ctrlKey || event.metaKey) && (event.key === "f" || event.key === "F")) {
      // Ours, not the browser's own bar.
      event.preventDefault()
      input.current?.select()
    }
  }

  return (
    <FloatBar className="absolute right-4 top-4 z-40 gap-1 pl-2.5" role="search" aria-label={t("Mindmap", "FindInMap")}>
      <AppIcon name="common/search" size={14} strokeWidth={1.7} className="shrink-0 text-ink-icon" />
      <input
        ref={input}
        type="text"
        value={find.query}
        placeholder={t("Mindmap", "FindInMap")}
        aria-label={t("Mindmap", "FindInMap")}
        onChange={(event) => find.setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        className="h-7 w-44 min-w-0 bg-transparent text-[12.5px] text-ink placeholder:text-ink-3 focus:outline-none"
      />
      <span className="min-w-[38px] text-center text-[11px] tabular-nums text-ink-3" aria-live="polite">
        {count}
      </span>
      <Sep />
      <Slot label={t("Mindmap", "FindPrevious")} disabled={find.count === 0} onClick={find.previous}>
        <AppIcon name="common/chevron-up" size={15} />
      </Slot>
      <Slot label={t("Mindmap", "FindNext")} disabled={find.count === 0} onClick={find.next}>
        <AppIcon name="common/chevron-down" size={15} />
      </Slot>
      <Slot label={t("Mindmap", "FindClose")} onClick={find.close}>
        <AppIcon name="common/x" size={15} />
      </Slot>
    </FloatBar>
  )
}
