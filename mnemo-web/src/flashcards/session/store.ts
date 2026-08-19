import { create } from "zustand"

import { ApiError } from "@/api/client"
import type { CardDto, ReviewGrade, SessionMode, SessionScope, StudySessionDto } from "@/api/types"
import { useI18nStore } from "@/i18n/store"
import { createTranslate } from "@/i18n/translate"
import { toast } from "@/stores/toast"

import { endSession, gradeCard, startSession, undoGrade } from "./api"

/**
 * Drives one live study session. The server owns the queue and answers every call with the whole
 * session, so this holds that payload plus the handful of things the server has no opinion on:
 * whether the answer is showing, and the two local overlays described below.
 */
interface SessionState {
  status: "idle" | "loading" | "ready" | "gone"
  session: StudySessionDto | null
  /** True once the answer half is showing. Reset by every card change. */
  revealed: boolean
  /**
   * The card as edited or flagged since the session started. `session.current` is the snapshot the
   * queue captured at start and never changes under us, so an edit or a flag has to be layered on
   * here - the next server response would otherwise put the stale text straight back.
   */
  card: CardDto | null
  /** True while a grade or undo is in flight, so a second one cannot start on top of it. */
  busy: boolean
  start: (deckId: string, mode: SessionMode, scope: SessionScope) => Promise<void>
  reveal: () => void
  grade: (grade: ReviewGrade) => Promise<void>
  undo: () => Promise<void>
  end: () => Promise<void>
  overlayCard: (card: CardDto) => void
  setFlagged: (flagged: boolean) => void
}

/**
 * Bumped by every start and end. StrictMode mounts effects twice, so two starts race on mount -
 * and the second one supersedes the first server-side, killing a session whose id we might
 * otherwise have kept and then graded into a 404. Whichever start no longer matches loses, and
 * ends the session it opened.
 */
let generation = 0

/** What a newly presented card resets: the answer hides and both local overlays are dropped. */
const PRESENTED = { revealed: false, card: null }

export const useSession = create<SessionState>((set, get) => ({
  status: "idle",
  session: null,
  revealed: false,
  card: null,
  busy: false,

  start: async (deckId, mode, scope) => {
    const mine = ++generation
    set({ status: "loading", session: null, busy: false, ...PRESENTED })
    try {
      const session = await startSession({ deckId, mode, scope })
      if (mine !== generation) {
        void endSession(session.sessionId)
        return
      }
      set({ status: "ready", session, ...PRESENTED })
    } catch {
      if (mine !== generation) return
      // The desktop bounces to the deck when a session cannot be started, with no error surface.
      set({ status: "gone", session: null })
    }
  },

  reveal: () => {
    if (get().session?.current == null || get().revealed) return
    set({ revealed: true })
  },

  grade: async (grade) => {
    const { session, revealed, busy, card } = get()
    const current = card ?? session?.current
    if (!session || !current || !revealed || busy) return

    set({ busy: true })
    try {
      // The card id is what stops a double-tap from grading the next, unseen card. A 409 comes
      // back as the session's real state, so it lands here like any other answer.
      const next = await gradeCard(session.sessionId, { cardId: current.id, grade })
      set({ session: next, busy: false, ...PRESENTED })
    } catch (error) {
      // The card stays revealed. The server commits a grade before it answers, so a failed
      // request can mean the grade landed anyway; un-revealing the card would tell the reader
      // nothing happened when it might have, and could let them grade it a second time.
      set({ busy: false })
      failed(error, "StudyGradeErrorTitle", () => void get().grade(grade), set)
    }
  },

  undo: async () => {
    const { session, busy } = get()
    if (!session?.canUndo || busy) return

    set({ busy: true })
    try {
      const next = await undoGrade(session.sessionId)
      set({ session: next, busy: false, ...PRESENTED })
    } catch (error) {
      set({ busy: false })
      failed(error, "StudyUndoErrorTitle", () => void get().undo(), set)
    }
  },

  end: async () => {
    const { session } = get()
    generation++
    set({ status: "idle", session: null, busy: false, ...PRESENTED })
    if (session) await endSession(session.sessionId).catch(() => undefined)
  },

  overlayCard: (card) => set({ card }),

  setFlagged: (flagged) => {
    const current = get().card ?? get().session?.current
    if (!current) return
    set({ card: { ...current, isFlagged: flagged } })
  },
}))

/**
 * A session the server no longer has - swept after an idle hour, or lost to a host restart -
 * cannot be resumed, so the screen gives up and the page sends the reader back to the deck.
 *
 * Anything else surfaces as a toast with a retry. Retrying the same grade or undo is always
 * safe even if the first attempt actually committed: gradeCard treats a stale-card 409 as the
 * session's real state rather than an error, so a repeat lands on the current card either way.
 */
function failed(
  error: unknown,
  titleKey: string,
  retry: () => void,
  set: (partial: Partial<SessionState>) => void,
) {
  if (error instanceof ApiError && error.status === 404) {
    set({ status: "gone", session: null })
    return
  }
  const t = createTranslate(useI18nStore.getState().bundle)
  toast.warning(t("Flashcards", titleKey), {
    description: error instanceof Error ? error.message : undefined,
    primary: { label: t("Flashcards", "Retry"), onClick: retry },
  })
}
