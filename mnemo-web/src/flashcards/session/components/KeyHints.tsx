import type { ReactNode } from "react"

import { isMac } from "@/keybinds/chord"
import { useT } from "@/i18n/useT"

/** The modifier the undo hint advertises, matching what the page actually listens for. */
const UNDO_KEY_LABEL = isMac ? "⌘Z" : "Ctrl+Z"

/** A keycap chip, as under the card and in the footer. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex min-w-5 items-center justify-center rounded-sm border border-line bg-[var(--widget-background-primary)] px-1.5 py-px font-mono text-[10.5px] text-text-secondary">
      {children}
    </span>
  )
}

function Hint({ children }: { children: ReactNode }) {
  return <span className="text-body-small text-text-tertiary">{children}</span>
}

/** The standing shortcut legend under the card: grade, good, edit, undo. */
export function HintRow() {
  const t = useT()
  const fc = (key: string) => t("Flashcards", key)

  return (
    <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5">
      <Kbd>{fc("StudyKeyGradeRange")}</Kbd>
      <Hint>{fc("StudyHintGrade")}</Hint>
      <Hint>·</Hint>
      <Kbd>{fc("StudyKeySpace")}</Kbd>
      <Hint>{fc("StudyHintGood")}</Hint>
      <Hint>·</Hint>
      <Kbd>E</Kbd>
      <Hint>{fc("StudyHintEdit")}</Hint>
      <Hint>·</Hint>
      <Kbd>{UNDO_KEY_LABEL}</Kbd>
      <Hint>{fc("StudyHintUndo")}</Hint>
    </div>
  )
}

/** The pre-reveal prompt: "Show answer" and the key that does it. */
export function RevealHint() {
  const t = useT()
  return (
    <div className="flex items-center justify-center gap-2">
      <Hint>{t("Flashcards", "StudyShowAnswerPrefix")}</Hint>
      <Kbd>{t("Flashcards", "StudyKeySpace")}</Kbd>
    </div>
  )
}
