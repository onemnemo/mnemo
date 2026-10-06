import { useLayoutEffect, useState } from "react"

import { useT } from "@/i18n/useT"
import { AlignBar } from "@/mindmap/chrome/AlignBar"
import { clampBar } from "@/mindmap/chrome/anchor"
import { Slot } from "@/mindmap/chrome/bits"

import { canDistribute } from "../align-ops"
import { cardCountOf } from "../cards"
import { boxOfMasks } from "../ops"
import { frameOf } from "../state"
import type { OcclusionEditor } from "../useOcclusionEditor"
import type { ActionChords } from "./useActionChords"
import { useExit } from "./useExit"

interface Placement {
  /** Top centre of the selection in pane pixels. */
  x: number
  y: number
  cards: number
  group: boolean
}

/** The bar over two or more cards, or over a group: Group or Ungroup, then align and distribute. */
export function OcclusionSelectionBar({ editor, chords }: { editor: OcclusionEditor; chords: ActionChords }) {
  const t = useT()
  const { store, state, document, selection, selectionIsGroup } = editor
  const cards = cardCountOf(document, selection)
  const union = cards >= 2 || selectionIsGroup ? boxOfMasks(document, selection) : null
  const frame = frameOf(state)

  const placement: Placement | null = union
    ? { x: frame.x + (union.x + union.w / 2) * frame.w, y: frame.y + union.y * frame.h, cards, group: selectionIsGroup }
    : null
  const { shown, leaving, ref, onTransitionEnd } = useExit(placement)

  const [size, setSize] = useState({ width: 0, height: 0 })
  const mounted = shown !== null
  const grouped = shown?.group
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const next = { width: element.offsetWidth, height: element.offsetHeight }
    setSize((old) => (old.width === next.width && old.height === next.height ? old : next))
    // The label changes the bar's width, and the element mounts with the first selection.
  }, [ref, grouped, mounted])

  if (!shown) return null

  const { box } = state.metrics
  // The bottom edge keeps clear of the tool bar along the bottom of the pane.
  const at = clampBar({ x: shown.x, y: shown.y }, size, { width: box.w, height: box.h }, { top: 0, left: 0, right: 0, bottom: 72 })
  const action = shown.group ? "ungroup" : "group"

  return (
    <div
      ref={ref}
      data-testid="occlusion-selection-bar"
      onTransitionEnd={onTransitionEnd}
      className="pointer-events-none absolute z-40"
      style={{
        left: at.x,
        top: at.y,
        transform: "translate(-50%, -100%)",
        opacity: leaving ? 0 : 1,
        transition: "opacity var(--duration-conceal) ease",
      }}
    >
      <AlignBar
        align={{ canDistribute: canDistribute(shown.cards), apply: (op) => store.align(op) }}
        leading={
          <Slot
            wide
            active={shown.group}
            label={t("Flashcards", shown.group ? "OcclusionUngroup" : "OcclusionGroup")}
            chord={chords.chord(action)}
            onClick={() => editor.perform(action)}
          >
            {t("Flashcards", shown.group ? "OcclusionUngroup" : "OcclusionGroup")}
          </Slot>
        }
      />
    </div>
  )
}
