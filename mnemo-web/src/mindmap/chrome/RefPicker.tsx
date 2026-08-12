import { Dialog } from "radix-ui"
import { useEffect, useMemo, useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useDecksQuery } from "@/flashcards/api"
import { useT } from "@/i18n/useT"
import { useNotesQuery } from "@/notes/api"

/** Which library is being picked from. The two reference kinds a node can point at. */
export type RefTarget = "note" | "flashcard"

export interface RefPickerProps {
  /** The library to pick from, or null when the picker is shut. */
  target: RefTarget | null
  onPick: (id: string) => void
  onClose: () => void
}

interface Row {
  id: string
  label: string
  /** What the target has waiting, such as a deck's due count. */
  badge?: string
}

/**
 * Choosing what a reference node points at.
 *
 * The whole library, filtered as you type, rather than a search that has to come back before it
 * shows anything: both lists are already fetched and cached for the map's existing references, and
 * a map with a handful of notes should not make anyone type to see them.
 *
 * The list is not fetched until the picker opens. A map with no references pays for neither library
 * while it is shut, which is the same rule the resolver on the canvas follows.
 */
export function RefPicker({ target, onPick, onClose }: RefPickerProps) {
  const t = useT()
  const mm = (key: string) => t("Mindmap", key)
  const [query, setQuery] = useState("")

  const notes = useNotesQuery(target === "note")
  const decks = useDecksQuery(target === "flashcard")

  // A fresh pick starts on the whole list. Whatever narrowed the last one was about that node.
  useEffect(() => {
    setQuery("")
  }, [target])

  const rows = useMemo((): Row[] => {
    if (target === "note") {
      return (notes.data ?? []).map((note) => ({
        id: note.id,
        // Untitled is a state a note can be left in, and it still has to be pickable.
        label: note.title.trim() || t("Mindmap", "RefUntitled"),
      }))
    }
    if (target === "flashcard") {
      return (decks.data ?? []).map((deck) => ({
        id: deck.id,
        label: deck.name,
        badge:
          deck.dueCounts.total > 0 ? t("Mindmap", "DueBadge", { 0: deck.dueCounts.total }) : undefined,
      }))
    }
    return []
  }, [decks.data, notes.data, t, target])

  const needle = query.trim().toLowerCase()
  const shown = needle ? rows.filter((row) => row.label.toLowerCase().includes(needle)) : rows
  const pending = target === "note" ? notes.isPending : target === "flashcard" ? decks.isPending : false

  return (
    <Dialog.Root open={target != null} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[70vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-[var(--overlay-background)] p-5 shadow-elevation-4 focus:outline-none">
          <Dialog.Title className="text-heading-6 font-semibold text-foreground">
            {mm(target === "flashcard" ? "PickDeckTitle" : "PickNoteTitle")}
          </Dialog.Title>

          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={mm("RefSearchPlaceholder")}
            onKeyDown={(event) => {
              // Enter takes the first match, so a name typed in full never needs the mouse.
              if (event.key === "Enter" && shown[0]) {
                onPick(shown[0].id)
              }
            }}
            className="mt-3 w-full rounded-md border bg-[var(--text-control-background)] px-3 py-2 text-body-small text-foreground placeholder:text-[var(--text-control-placeholder-foreground)] focus:border-[var(--text-control-border-focused)] focus:outline-none"
          />

          <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
            {pending ? (
              <p className="px-1 py-6 text-center text-body-small text-muted-foreground">{mm("Loading")}</p>
            ) : shown.length === 0 ? (
              <p className="px-1 py-6 text-center text-body-small text-muted-foreground">
                {mm("RefPickerEmpty")}
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {shown.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => onPick(row.id)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body-small text-foreground transition-colors hover:bg-secondary"
                    >
                      <AppIcon
                        name={target === "flashcard" ? "sidebar/flashcard" : "sidebar/notes"}
                        size={14}
                        className="text-muted-foreground"
                      />
                      <span className="min-w-0 flex-1 truncate">{row.label}</span>
                      {row.badge ? (
                        <span className="shrink-0 text-caption text-muted-foreground">{row.badge}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-secondary px-3 py-1.5 text-body-small font-medium text-secondary-foreground transition-colors hover:brightness-95"
            >
              {mm("Cancel")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
