import type { ReactNode } from "react"

import { isMac } from "@/keybinds/chord"
import { useT } from "@/i18n/useT"

/** The modifier the undo hint advertises, matching what the page actually listens for. */
const UNDO_KEY_LABEL = isMac ? "⌘Z" : "Ctrl+Z"

/** A keycap chip, filled rather than outlined so a row of them stays quiet under the card. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-[5px] bg-canvas-sunken px-1.5 py-0.5 font-sans text-[11px] font-medium text-ink-3">
      {children}
    </kbd>
  )
}

function Dot() {
  return <span className="text-ink-3">·</span>
}

function Word({ children }: { children: ReactNode }) {
  return <span className="text-[11.5px] text-ink-3">{children}</span>
}

function HintLine({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-center gap-1.5">{children}</div>
}

/** Shown before the answer is up: what the keys do while you are still recalling. */
export function PreRevealHint() {
  const t = useT()
  const fc = (key: string) => t("Flashcards", key)
  return (
    <HintLine>
      <Kbd>E</Kbd>
      <Word>{fc("StudyHintEdit")}</Word>
      <Dot />
      <Kbd>{UNDO_KEY_LABEL}</Kbd>
      <Word>{fc("StudyHintUndo")}</Word>
      <Dot />
      <Kbd>Esc</Kbd>
      <Word>{fc("StudyHintEnd")}</Word>
    </HintLine>
  )
}

/** Shown once the answer is up: grade, the space shortcut, and undo. */
export function PostRevealHint() {
  const t = useT()
  const fc = (key: string) => t("Flashcards", key)
  return (
    <HintLine>
      <Kbd>{fc("StudyKeyGradeRange")}</Kbd>
      <Word>{fc("StudyHintGrade")}</Word>
      <Dot />
      <Kbd>{fc("StudyKeySpace")}</Kbd>
      <Word>{fc("StudyHintGood")}</Word>
      <Dot />
      <Kbd>{UNDO_KEY_LABEL}</Kbd>
      <Word>{fc("StudyHintUndo")}</Word>
    </HintLine>
  )
}
