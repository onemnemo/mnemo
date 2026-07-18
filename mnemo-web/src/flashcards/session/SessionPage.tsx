import { useEffect, useRef } from "react"

import type { ReviewGrade, SessionMode, SessionScope } from "@/api/types"
import { navigate } from "@/app/router"
import { useT } from "@/i18n/useT"
import { isEditableTarget, isMac } from "@/keybinds/chord"
import { dialog } from "@/stores/dialog"

import { useFlagCards } from "../deck/api"
import { isModalOpen } from "@/lib/modal"

import { useCardEditor } from "../editor/store"
import { fetchCard } from "./api"
import { isActive, isAllCaughtUp } from "./session"
import { useSession } from "./store"
import { CardSurface } from "./components/CardSurface"
import { EndPanel } from "./components/EndPanel"
import { GradeRow } from "./components/GradeRow"
import { HintRow, RevealHint } from "./components/KeyHints"
import { SessionTopbar } from "./components/SessionTopbar"

const AUTO_REVEAL_SECONDS: Record<string, number> = { "five-seconds": 5, "ten-seconds": 10 }

const GRADE_KEYS: Record<string, ReviewGrade> = { "1": "again", "2": "hard", "3": "good", "4": "easy" }

/**
 * The review and cram study screen. The queue, the scheduling and the undo stack all live in the
 * server-held session; this drives it and owns only what the server has no view on - whether the
 * answer is showing, the auto-reveal countdown, and the keyboard.
 */
export function SessionPage({ deckId, mode, scope }: { deckId?: string; mode?: string; scope?: string }) {
  const t = useT()
  const session = useSession((s) => s.session)
  const status = useSession((s) => s.status)
  const revealed = useSession((s) => s.revealed)
  const overlaid = useSession((s) => s.card)
  const busy = useSession((s) => s.busy)

  const editorTarget = useCardEditor((s) => s.target)
  const openEdit = useCardEditor((s) => s.openEdit)
  const flagCards = useFlagCards(deckId ?? "")

  const card = overlaid ?? session?.current ?? null
  const active = isActive(session)
  const currentId = session?.current?.id

  const backToDeck = () => (deckId ? navigate("flashcard-deck", deckId) : navigate("flashcards"))

  // Start once for this deck, and end the session when the screen goes away so the study it
  // represents is recorded rather than waiting to be swept.
  useEffect(() => {
    if (!deckId) {
      navigate("flashcards")
      return
    }
    const start = useSession.getState().start
    void start(deckId, mode === "cram" ? "cram" : ("review" as SessionMode), scope === "all" ? "all" : ("due" as SessionScope))
    return () => void useSession.getState().end()
  }, [deckId, mode, scope])

  // A session the server has lost cannot be resumed, so the reader goes back to the deck - which
  // is also where the desktop lands when a session fails to start.
  useEffect(() => {
    if (status !== "gone") return
    if (deckId) navigate("flashcard-deck", deckId)
    else navigate("flashcards")
  }, [status, deckId])

  // Auto-reveal is a deck-preset setting, read once at start. Keyed on the card so an undo, which
  // brings a card back unrevealed, restarts the countdown the way a new card does.
  useEffect(() => {
    if (!currentId || revealed || !session) return
    const seconds = AUTO_REVEAL_SECONDS[session.autoReveal] ?? 0
    if (seconds <= 0) return
    const timer = window.setTimeout(() => useSession.getState().reveal(), seconds * 1000)
    return () => window.clearTimeout(timer)
  }, [currentId, revealed, session])

  // The editor has no close event, so a target going back to null is the signal that an edit
  // finished and the card on screen may no longer say what it said.
  const editorWasOpen = useRef(false)
  useEffect(() => {
    const open = editorTarget !== null
    const justClosed = editorWasOpen.current && !open
    editorWasOpen.current = open
    if (!justClosed || !currentId) return
    void fetchCard(currentId)
      .then((fresh) => useSession.getState().overlayCard(fresh))
      .catch(() => undefined)
  }, [editorTarget, currentId])

  const close = async () => {
    const state = useSession.getState()
    if (state.session?.current && state.session.graded > 0) {
      const ok = await dialog.confirm({
        title: t("Flashcards", "StudyLeaveTitle"),
        message: t("Flashcards", "StudyLeaveMessage"),
        confirmLabel: t("Flashcards", "StudyLeaveConfirm"),
        cancelLabel: t("Common", "Cancel"),
      })
      if (!ok) return
    }
    backToDeck()
  }

  const editCurrent = () => {
    const id = useSession.getState().session?.current?.id
    if (deckId && id) openEdit(deckId, id)
  }

  const toggleFlag = () => {
    const shown = useSession.getState()
    const target = shown.card ?? shown.session?.current
    if (!deckId || !target) return
    const value = !target.isFlagged
    // Shown straight away: the session's copy of the card is frozen, so nothing will echo this
    // back and waiting for the write would leave the icon lying about its own click.
    shown.setFlagged(value)
    void flagCards.mutateAsync({ cardIds: [target.id], value }).catch(() => shown.setFlagged(!value))
  }

  // The listener wants whatever these are on the keypress, not on the render that bound it, so
  // they ride in a ref rather than making the window listener rebind on every render.
  const actions = useRef({ close, editCurrent })
  actions.current = { close, editCurrent }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return
      // A dialog is focus-trapped, but this listener is on the window and still fires - including
      // behind the app's own "leave session?" confirm, where Space would grade the card it asks about.
      if (isModalOpen()) return
      if (isEditableTarget(event.target)) return

      const state = useSession.getState()

      // Checked before the bare-key gate, and works on the completion screen too: undo there
      // pulls the last card back rather than being a no-op.
      if ((isMac ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault()
        void state.undo()
        return
      }

      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return

      if (event.key === "Escape") {
        event.preventDefault()
        void actions.current.close()
        return
      }

      if (event.key === " ") {
        event.preventDefault()
        if (state.session?.current && !state.revealed) state.reveal()
        else void state.grade("good")
        return
      }

      if (event.key === "e" || event.key === "E") {
        event.preventDefault()
        actions.current.editCurrent()
        return
      }

      const grade = GRADE_KEYS[event.key]
      if (grade) {
        event.preventDefault()
        void state.grade(grade)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SessionTopbar session={session} active={active} onClose={() => void close()} />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {status === "loading" && (
          <span className="m-auto text-text-tertiary">{t("Flashcards", "StudyLoading")}</span>
        )}

        {active && card && session && (
          // w-full so this stretches to the pane rather than shrink-wrapping the 780px card,
          // which would push the whole page into a horizontal scroll on a narrow window.
          <div className="m-auto flex w-full flex-col items-center gap-[18px] p-6">
            <CardSurface
              card={card}
              revealed={revealed}
              canUndo={session.canUndo && !busy}
              onReveal={() => useSession.getState().reveal()}
              onEdit={editCurrent}
              onFlag={toggleFlag}
              onUndo={() => void useSession.getState().undo()}
            />

            {revealed ? (
              <GradeRow
                intervals={session.intervals}
                disabled={busy}
                onGrade={(grade) => void useSession.getState().grade(grade)}
              />
            ) : (
              <RevealHint />
            )}

            <HintRow />
          </div>
        )}

        {session && !active && (
          <EndPanel
            caughtUp={isAllCaughtUp(session)}
            completed={session.progress.completed}
            onBackToDeck={backToDeck}
          />
        )}
      </div>
    </div>
  )
}
