import { useEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react"

import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu"
import { useT } from "@/i18n/useT"
import { usePointerDrag } from "@/lib/dnd/usePointerDrag"

import { cardCountOf, cardOf, type CardEntry } from "../cards"
import type { EditorAction } from "../keys"
import type { OcclusionEditor } from "../useOcclusionEditor"
import { CardRow } from "./CardRow"
import { MaskMenuContent } from "./MaskMenu"
import { maskMenuItems } from "./mask-menu"
import type { ActionChords } from "./useActionChords"

interface Drop {
  id: string
  /** Position in card order the card ends up at. */
  index: number
  /** The gap between rows the line is drawn in. */
  slot: number
}

export interface CardsListProps {
  editor: OcclusionEditor
  chords: ActionChords
  /** The mask whose card is being renamed, or null. */
  renaming: string | null
  onRenaming: (maskId: string | null) => void
}

/** The cards the fact makes, in order: select, rename in place, reorder by dragging, right-click for more. */
export function CardsList({ editor, chords, renaming, onRenaming }: CardsListProps) {
  const t = useT()
  const { store, cards, document: doc, selection, selectionIsGroup } = editor
  const list = useRef<HTMLDivElement>(null)
  const picked = useRef<EditorAction | null>(null)
  // The mask whose row takes focus back once a rename has ended on a key.
  const refocus = useRef<string | null>(null)

  const ownLabel = useMemo(() => new Map(doc.masks.map((mask) => [mask.id, mask.label ?? ""])), [doc])
  const selected = useMemo(() => new Set(selection), [selection])
  const renamingKey = renaming ? cardOf(cards, renaming)?.key : undefined
  const selectedKey = selection.length > 0 ? cardOf(cards, selection[0])?.key : undefined
  const tabStop = selectedKey ?? cards[0]?.key

  const drag = usePointerDrag<CardEntry, number, Drop>({
    getKey: (card) => card.key,
    resolve: (pointer) => {
      const rows = [...(list.current?.querySelectorAll("[data-card-row]") ?? [])]
      return rows.filter((row) => {
        const box = row.getBoundingClientRect()
        return box.top + box.height / 2 < pointer.y
      }).length
    },
    plan: (card, slot) => {
      const from = cards.findIndex((entry) => entry.key === card.key)
      const index = slot > from ? slot - 1 : slot
      return index === from ? null : { id: card.ids[0], index, slot }
    },
    onDrop: (drop) => store.moveCard(drop.id, drop.index),
  })

  // Row handlers stay the same function across renders, so a gesture that redraws the list does
  // not redraw every row; what changes between renders is read from here.
  const latest = useRef({ cards, renaming, press: drag.press })
  latest.current = { cards, renaming, press: drag.press }

  const focusRow = (key: string) => {
    const rows = [...(list.current?.querySelectorAll<HTMLElement>("[data-card-row]") ?? [])]
    rows.find((row) => row.dataset.cardRow === key)?.focus()
  }

  const handlers = useMemo(() => {
    const cardAt = (id: string) => latest.current.cards.find((card) => card.ids[0] === id)
    const endRename = () => {
      refocus.current = latest.current.renaming
      onRenaming(null)
    }
    return {
      onSelect: (id: string, event: MouseEvent) =>
        store.select([id], event.shiftKey || event.ctrlKey || event.metaKey ? "toggle" : "replace"),
      onHover: (id: string | null) => store.setHovered(id),
      onStartRename: (id: string) => {
        store.select([id])
        onRenaming(id)
      },
      onCommit: (id: string, label: string, viaKey: boolean) => {
        store.rename(id, label)
        if (viaKey) endRename()
        else onRenaming(null)
      },
      onCancel: endRename,
      onTab: (id: string, label: string, backwards: boolean) => {
        store.rename(id, label)
        const all = latest.current.cards
        const next = all[all.findIndex((card) => card.ids[0] === id) + (backwards ? -1 : 1)]
        if (!next) return endRename()
        store.select([next.ids[0]])
        onRenaming(next.ids[0])
      },
      onGripPress: (id: string, event: PointerEvent) => {
        const card = cardAt(id)
        if (card) latest.current.press(event, card)
      },
      onKey: (id: string, event: KeyboardEvent) => {
        if (event.target !== event.currentTarget) return
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
        const all = latest.current.cards
        const from = all.findIndex((card) => card.ids[0] === id)
        const last = all.length - 1
        const to: number | null =
          event.key === "ArrowDown" ? Math.min(from + 1, last)
          : event.key === "ArrowUp" ? Math.max(from - 1, 0)
          : event.key === "Home" ? 0
          : event.key === "End" ? last
          : event.key === "Enter" || event.key === " " ? from
          : null
        if (to === null) return
        event.preventDefault()
        const target = all[to]
        if (!target) return
        store.select([target.ids[0]])
        focusRow(target.key)
      },
    }
    // focusRow only reads the list ref.
  }, [store, onRenaming])

  useEffect(() => {
    if (renaming !== null || refocus.current === null) return
    const card = cardOf(latest.current.cards, refocus.current)
    refocus.current = null
    if (card) focusRow(card.key)
  }, [renaming])

  useEffect(() => {
    const row = selectedKey ? [...(list.current?.querySelectorAll("[data-card-row]") ?? [])].find((r) => (r as HTMLElement).dataset.cardRow === selectedKey) : null
    row?.scrollIntoView?.({ block: "nearest" })
  }, [selectedKey])

  const menu = maskMenuItems(t, { cards: cardCountOf(doc, selection), isGroup: selectionIsGroup }, chords.hint)

  // One menu serves every row. It opens over a row only, and acts on that row's card.
  const guardMenu = (event: MouseEvent) => {
    const key = (event.target as Element).closest<HTMLElement>("[data-card-row]")?.dataset.cardRow
    const card = cards.find((entry) => entry.key === key)
    if (!card) return event.preventDefault()
    if (!card.ids.every((id) => selected.has(id))) store.select([card.ids[0]])
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={list}
          role="grid"
          aria-multiselectable="true"
          aria-label={t("Flashcards", "OcclusionCardsLabel")}
          onContextMenu={guardMenu}
          className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto"
        >
          {cards.map((card, index) => {
            const mark = drag.target === null ? null : drag.target === index ? "before" : drag.target === cards.length && index === cards.length - 1 ? "after" : null
            return (
              <CardRow
                key={card.key}
                id={card.ids[0]}
                cardKey={card.key}
                number={card.number}
                label={card.label}
                grouped={card.grouped}
                ownLabel={ownLabel.get(card.ids[0]) ?? ""}
                selected={card.ids.every((id) => selected.has(id))}
                tabStop={card.key === tabStop}
                renaming={renamingKey === card.key}
                dragging={drag.sourceKey === card.key}
                dropMark={mark}
                {...handlers}
              />
            )
          })}
        </div>
      </ContextMenuTrigger>
      <MaskMenuContent items={menu} keepFocusAfter={picked} onPick={(action) => editor.perform(action)} />
    </ContextMenu>
  )
}
