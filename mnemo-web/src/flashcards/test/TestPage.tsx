import { type ReactNode, useEffect, useRef } from "react"
import { createPortal } from "react-dom"

import { navigate } from "@/app/router"
import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"
import { isEditableTarget, isMac } from "@/keybinds/chord"
import { dialog } from "@/stores/dialog"

import { useFlagCards } from "../deck/api"
import { isModalOpen } from "@/lib/modal"

import { useCardEditor } from "../editor/store"
import { fetchCard } from "../session/api"
import { Kbd } from "../session/components/KeyHints"
import { ScorePanel } from "./components/ScorePanel"
import { TestCard } from "./components/TestCard"
import { TestGradeRow } from "./components/TestGradeRow"
import { TestTopbar } from "./components/TestTopbar"
import { useTest } from "./store"
import { type TestGrade, tested } from "./test"

const GRADE_KEYS: Record<string, TestGrade> = { "1": "missed", "2": "close", "3": "gotIt" }

/**
 * The test screen. Everything it runs on is client-side - Test scores itself and writes no
 * schedule - so unlike the review screen there is no server session behind it, only a queue it
 * was handed and two records it leaves behind.
 */
export function TestPage({ deckId }: { deckId?: string }) {
  const t = useT()
  const fc = (key: string) => t("Flashcards", key)

  const status = useTest((s) => s.status)
  const deckName = useTest((s) => s.deckName)
  const queue = useTest((s) => s.queue)
  const index = useTest((s) => s.index)
  const answers = useTest((s) => s.answers)
  const grades = useTest((s) => s.grades)
  const tally = useTest((s) => s.tally)
  const revealed = useTest((s) => s.revealed)
  const result = useTest((s) => s.result)
  const resultFailed = useTest((s) => s.resultFailed)

  const editorTarget = useCardEditor((s) => s.target)
  const openEdit = useCardEditor((s) => s.openEdit)
  const flagCards = useFlagCards(deckId ?? "")

  const card = queue[index] ?? null
  const active = status === "active" && card !== null

  const backToDeck = () => (deckId ? navigate("flashcard-deck", deckId) : navigate("flashcards"))

  // Start once for this deck, and record the effort when the screen goes away - the only moment
  // a test that was abandoned rather than finished gets to say it happened.
  useEffect(() => {
    if (!deckId) {
      navigate("flashcards")
      return
    }
    void useTest.getState().start(deckId)
    return () => void useTest.getState().leave()
  }, [deckId])

  // A queue that could not be fetched leaves nothing to run, so the reader goes back to the deck -
  // which is also where the desktop lands when a test fails to start.
  useEffect(() => {
    if (status !== "gone") return
    if (deckId) navigate("flashcard-deck", deckId)
    else navigate("flashcards")
  }, [status, deckId])

  // The editor has no close event, so a target going back to null is the signal that an edit
  // finished and the card on screen may no longer say what it said.
  const editorWasOpen = useRef(false)
  useEffect(() => {
    const open = editorTarget !== null
    const justClosed = editorWasOpen.current && !open
    editorWasOpen.current = open
    if (!justClosed || !card) return
    void fetchCard(card.id)
      .then((fresh) => useTest.getState().replaceCurrent(fresh))
      .catch(() => undefined)
  }, [editorTarget, card])

  const close = async () => {
    const state = useTest.getState()
    // Only a test in progress is worth stopping for: abandoning it loses the score, where the
    // score screen has already recorded everything it was going to.
    if (state.status === "active" && tested(state.tally) > 0) {
      const ok = await dialog.confirm({
        title: fc("TestLeaveTitle"),
        message: fc("TestLeaveMessage"),
        confirmLabel: fc("StudyLeaveConfirm"),
        cancelLabel: t("Common", "Cancel"),
      })
      if (!ok) return
    }
    backToDeck()
  }

  const editCurrent = () => {
    const state = useTest.getState()
    const id = state.queue[state.index]?.id
    if (deckId && id) openEdit(deckId, id)
  }

  const toggleFlag = () => {
    const state = useTest.getState()
    const target = state.queue[state.index]
    if (!deckId || !target) return
    const value = !target.isFlagged
    // Shown straight away; the write is slower than the click and nothing echoes it back.
    state.setFlagged(value)
    void flagCards.mutateAsync({ cardIds: [target.id], value }).catch(() => state.setFlagged(!value))
  }

  // The listener wants whatever these are on the keypress, not on the render that bound it, so
  // they ride in a ref rather than making the window listener rebind on every render.
  const actions = useRef({ close, editCurrent })
  actions.current = { close, editCurrent }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return
      // A dialog is focus-trapped, but this listener is on the window and still fires - including
      // behind the app's own "leave test?" confirm, where Enter would grade the card it asks about.
      if (isModalOpen()) return

      const bare = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey

      // Checked before the answer box, because Escape leaves the test from anywhere - including
      // mid-sentence - exactly as it does on the desktop.
      if (event.key === "Escape" && bare) {
        event.preventDefault()
        void actions.current.close()
        return
      }

      // Everything else belongs to the box while it has focus: the typing, and its own undo.
      if (isEditableTarget(event.target)) return

      const state = useTest.getState()

      if ((isMac ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault()
        state.undo()
        return
      }

      // Before the answer is revealed nothing here is bound - the box owns the keyboard, and
      // grading a card the reader has not answered yet would be nonsense.
      if (!bare || !state.revealed) return

      if (event.key === "Enter") {
        event.preventDefault()
        state.grade("gotIt")
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
        state.grade(grade)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const missed = queue.filter((_, i) => grades[i] === "missed")

  // Rendered over the whole window rather than inside the module frame: during a test the card is
  // the screen, and the practice-only badge on every card is the one thing the reader has to trust.
  return createPortal(
    <div className="animate-fade-in fixed inset-0 z-[130] flex flex-col bg-canvas">
      <TestTopbar
        deckId={deckId}
        deckName={deckName}
        tally={tally}
        completed={index}
        total={queue.length}
        active={active}
        onClose={() => void close()}
      />

      {status === "loading" && (
        <div className="flex flex-1 items-center justify-center">
          <span className="text-ink-3">{fc("StudyLoading")}</span>
        </div>
      )}

      {status === "empty" && (
        <div className="m-auto flex max-w-[420px] flex-col items-center gap-4 px-6 text-center">
          <AppIcon name="common/file-text" size={48} className="text-ink-3" />
          <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-ink">{fc("TestEmptyTitle")}</h2>
          <p className="text-[13.5px] text-ink-2">{fc("TestEmptyDesc")}</p>
          <Button onClick={backToDeck}>{fc("BackToDeck")}</Button>
        </div>
      )}

      {active && card && (
        // Card and buttons are one block, centred together, so the grade row never floats far
        // above the card the way pinning it to the window bottom would on a short prompt.
        <div className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto px-6">
          <div className="m-auto w-full max-w-[780px] py-8">
            <TestCard
              card={card}
              answer={answers[index] ?? ""}
              revealed={revealed}
              canUndo={index > 0}
              onAnswerChange={(text) => useTest.getState().setAnswer(text)}
              onReveal={() => useTest.getState().reveal()}
              onEdit={editCurrent}
              onFlag={toggleFlag}
              onUndo={() => useTest.getState().undo()}
            />

            <div className="mt-6">
              {revealed ? (
                <TestGradeRow onGrade={(grade) => useTest.getState().grade(grade)} />
              ) : (
                <div className="flex items-center justify-center gap-2">
                  <Button variant="outline" onClick={() => useTest.getState().reveal()}>
                    {fc("TestReveal")}
                  </Button>
                  <Kbd>{fc("StudyKeyEnter")}</Kbd>
                </div>
              )}
              <div className="mt-3">
                <HintRow />
              </div>
            </div>
          </div>
        </div>
      )}

      {status === "complete" && (
        <ScorePanel
          deckName={deckName}
          tally={tally}
          result={result}
          failed={resultFailed}
          missed={missed}
          onBackToDeck={backToDeck}
        />
      )}
    </div>,
    document.body,
  )
}

/** The shortcut legend under the card. Test grades on 1-3 and takes Enter for "got it". */
function HintRow() {
  const t = useT()
  const fc = (key: string) => t("Flashcards", key)

  return (
    <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5">
      <Kbd>{fc("TestKeyGradeRange")}</Kbd>
      <Hint>{fc("StudyHintGrade")}</Hint>
      <Hint>·</Hint>
      <Kbd>{fc("StudyKeyEnter")}</Kbd>
      <Hint>{fc("TestHintGotIt")}</Hint>
      <Hint>·</Hint>
      <Kbd>E</Kbd>
      <Hint>{fc("StudyHintEdit")}</Hint>
      <Hint>·</Hint>
      <Kbd>{isMac ? "⌘Z" : "Ctrl+Z"}</Kbd>
      <Hint>{fc("StudyHintUndo")}</Hint>
    </div>
  )
}

function Hint({ children }: { children: ReactNode }) {
  return <span className="text-[11.5px] text-ink-3">{children}</span>
}
