import { create } from "zustand"

import { fetchAiSettings, putWebSearchEnabled } from "@/api/ai"
import { ApiError } from "@/api/client"
import { useI18nStore } from "@/i18n/store"
import { createTranslate } from "@/i18n/translate"
import type { TranslateFn } from "@/i18n/types"

import {
  deleteConversation as apiDeleteConversation,
  fetchConversation,
  fetchConversations,
  renameConversation as apiRenameConversation,
  setConversationMode,
} from "./api"
import { LiveTraceBuilder } from "./trace"
import { cancelTurn, streamTurn } from "./turn-stream"
import type {
  AssistantMode,
  ChatConversationSummary,
  ChatMessage,
  ChatMessageView,
  ChatTurnNotice,
} from "./types"

const DEFAULT_MODE: AssistantMode = "Normal"

// Live per-turn scratch. Held outside zustand state because the trace builder is
// mutable and only one turn runs at a time. The visible trace/content it produces
// is mirrored into the streaming message in state on each event.
interface ActiveTurn {
  turnId: string
  abort: AbortController
  builder: LiveTraceBuilder
  content: string
  sawTool: boolean
  stopped: boolean
  done: boolean
  foundResponse: boolean
  error: ChatTurnNotice | null
}

interface ChatState {
  // Sidebar
  conversations: ChatConversationSummary[]
  conversationsLoaded: boolean

  // Active conversation
  activeId: string | null
  isEphemeral: boolean
  messages: ChatMessageView[]
  assistantMode: AssistantMode
  activeLoaded: boolean

  // Turn
  isBusy: boolean

  // Global feature settings
  webSearchEnabled: boolean

  // Actions
  init: () => Promise<void>
  newChat: () => void
  selectConversation: (id: string) => Promise<void>
  renameConversation: (id: string, title: string) => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  setMode: (mode: AssistantMode) => void
  setWebSearch: (enabled: boolean) => void
  sendMessage: (text: string) => Promise<void>
  retryLastTurn: () => Promise<void>
  stop: () => void
}

function currentT(): TranslateFn {
  return createTranslate(useI18nStore.getState().bundle)
}

function nowIso(): string {
  return new Date().toISOString()
}

/** An empty persisted-message skeleton with the transient view fields set. */
function makeMessage(partial: Partial<ChatMessageView> & Pick<ChatMessage, "content" | "isUser">): ChatMessageView {
  return {
    suggestions: null,
    sources: null,
    attachments: null,
    thoughts: null,
    thoughtsCount: 0,
    processHeaderText: null,
    elapsedText: null,
    processSummaryText: null,
    processThreadExpanded: null,
    feedback: 0,
    processSteps: null,
    timestampUtc: nowIso(),
    streaming: false,
    notice: null,
    ...partial,
  }
}

/** Sidebar title preview for an optimistic new-conversation row (server re-derives on refetch). */
function clampTitle(text: string): string {
  const t = text.trim().replace(/[\r\n]+/g, " ")
  return t.length > 48 ? `${t.slice(0, 45)}…` : t
}

/** Maps an AI error kind (or a transport failure) to the inline notice the SPA shows. */
function noticeForError(kind: string | undefined, message: string | undefined, t: TranslateFn): ChatTurnNotice {
  switch (kind) {
    case "invalid_api_key":
      return { kind: "missing_api_key", text: t("Chat", "ErrorMissingApiKey") }
    case "model_unavailable":
      return { kind: "model_unavailable", text: t("Chat", "ErrorNoModel") }
    default: {
      const trimmed = message?.trim()
      return { kind: "error", text: trimmed && trimmed.length > 0 ? trimmed : t("Chat", "ErrorSorry") }
    }
  }
}

export const useChatStore = create<ChatState>((set, get) => {
  // The turn in flight, if any. Never read by React — only orchestrates the stream.
  let active: ActiveTurn | null = null

  /** Rewrites the trailing streaming assistant message with a patch (content/trace/notice). */
  function patchStreaming(patch: Partial<ChatMessageView>): void {
    set((s) => {
      if (s.messages.length === 0) return s
      const messages = s.messages.slice()
      const last = messages.length - 1
      messages[last] = { ...messages[last], ...patch }
      return { messages }
    })
  }

  async function refreshConversations(): Promise<void> {
    try {
      const conversations = await fetchConversations()
      set({ conversations, conversationsLoaded: true })
    } catch {
      // A stale sidebar is better than a thrown turn; leave what we have.
    }
  }

  function handleEvent(evt: Parameters<Parameters<typeof streamTurn>[2]["onEvent"]>[0], t: TranslateFn): void {
    if (!active) return
    switch (evt.type) {
      case "status":
        active.builder.onPipelineKey(evt.data.key, t)
        patchStreaming({ processSteps: active.builder.snapshot() })
        break
      case "tool":
        active.sawTool = true
        active.builder.addToolCall(evt.data, t)
        patchStreaming({ processSteps: active.builder.snapshot() })
        break
      case "reasoning":
        active.builder.setReasoning(evt.data.text)
        patchStreaming({ thoughts: active.builder.reasoning })
        break
      case "narration":
        active.builder.addNarration(evt.data.text)
        patchStreaming({ processSteps: active.builder.snapshot() })
        break
      case "delta":
        active.content += evt.data.text
        patchStreaming({ content: active.content })
        break
      case "done":
        active.done = true
        active.foundResponse = evt.data.foundResponse
        active.stopped = evt.data.stopped
        active.content = evt.data.content
        break
      case "error":
        active.error = noticeForError(evt.data.kind, evt.data.message, t)
        break
    }
  }

  async function runTurn(conversationId: string, message: string, mode: AssistantMode): Promise<void> {
    const t = currentT()
    const turn: ActiveTurn = {
      turnId: crypto.randomUUID(),
      abort: new AbortController(),
      builder: new LiveTraceBuilder(),
      content: "",
      sawTool: false,
      stopped: false,
      done: false,
      foundResponse: false,
      error: null,
    }
    active = turn

    try {
      await streamTurn(
        conversationId,
        { turnId: turn.turnId, message, assistantMode: mode },
        { signal: turn.abort.signal, onEvent: (evt) => handleEvent(evt, t) },
      )
    } catch (err) {
      // A transport/HTTP failure before or during the stream (not an in-band error
      // event). Aborting for a client stop lands here too — but a stop is graceful
      // (the server sends a done event first), so only treat a real failure as one.
      if (!turn.abort.signal.aborted) {
        const message = err instanceof ApiError ? err.message : t("Chat", "ErrorUnexpected")
        turn.error = { kind: "error", text: message }
      }
    }

    // Resolve the turn. A failed turn (error, or an empty answer that ran no tools)
    // is not persisted server-side — the whole pair is dropped — so we keep it in
    // our own memory as a notice. Anything persisted is re-read canonical, which
    // also gives the resolved trace header/elapsed/summary we don't build client-side.
    turn.builder.complete()
    const persisted = !turn.error && (turn.foundResponse || turn.stopped || turn.sawTool)

    if (persisted) {
      try {
        const convo = await fetchConversation(conversationId)
        set({ messages: convo.messages as ChatMessageView[], assistantMode: convo.assistantMode })
      } catch {
        // Fall back to the streamed content if the canonical re-read fails.
        patchStreaming({ streaming: false, content: turn.content, processSteps: turn.builder.snapshot() })
      }
      void refreshConversations()
    } else {
      const notice = turn.error ?? { kind: "error", text: t("Chat", "ErrorSorry") }
      patchStreaming({ streaming: false, notice, content: "", processSteps: null, thoughts: null })
    }

    active = null
    set({ isBusy: false })
  }

  return {
    conversations: [],
    conversationsLoaded: false,
    activeId: null,
    isEphemeral: true,
    messages: [],
    assistantMode: DEFAULT_MODE,
    activeLoaded: false,
    isBusy: false,
    webSearchEnabled: false,

    async init() {
      await Promise.all([
        refreshConversations(),
        fetchAiSettings()
          .then((s) => set({ webSearchEnabled: s.webSearchEnabled }))
          .catch(() => {}),
      ])
    },

    newChat() {
      get().stop()
      set({ activeId: null, isEphemeral: true, messages: [], assistantMode: DEFAULT_MODE, activeLoaded: true })
    },

    async selectConversation(id) {
      get().stop()
      set({ activeId: id, isEphemeral: false, activeLoaded: false })
      try {
        const convo = await fetchConversation(id)
        // Ignore a late response if the user has since navigated away.
        if (get().activeId !== id) return
        set({
          messages: convo.messages as ChatMessageView[],
          assistantMode: convo.assistantMode,
          activeLoaded: true,
        })
      } catch {
        if (get().activeId === id) set({ messages: [], activeLoaded: true })
      }
    },

    async renameConversation(id, title) {
      const updated = await apiRenameConversation(id, title)
      set((s) => ({
        conversations: s.conversations.map((c) => (c.id === id ? updated : c)),
      }))
    },

    async deleteConversation(id) {
      await apiDeleteConversation(id)
      set((s) => ({ conversations: s.conversations.filter((c) => c.id !== id) }))
      if (get().activeId === id) get().newChat()
    },

    setMode(mode) {
      set({ assistantMode: mode })
      const { activeId, isEphemeral } = get()
      // A real conversation persists the change now (so switching then navigating
      // away sticks); an ephemeral one carries it into its first turn request.
      if (activeId && !isEphemeral) void setConversationMode(activeId, mode).catch(() => {})
    },

    setWebSearch(enabled) {
      set({ webSearchEnabled: enabled })
      void putWebSearchEnabled(enabled).catch(() => {})
    },

    async sendMessage(text) {
      const trimmed = text.trim()
      const state = get()
      if (!trimmed || state.isBusy) return

      const mode = state.assistantMode
      const isNew = state.isEphemeral || !state.activeId
      const conversationId = state.activeId ?? crypto.randomUUID()

      const userMsg = makeMessage({ content: trimmed, isUser: true })
      const assistantMsg = makeMessage({ content: "", isUser: false, streaming: true, processThreadExpanded: true })

      set((s) => ({
        activeId: conversationId,
        isEphemeral: false,
        activeLoaded: true,
        isBusy: true,
        messages: [...s.messages, userMsg, assistantMsg],
        // Optimistically float a sidebar row for a brand-new conversation; the
        // canonical row (with the server-derived title) arrives on the post-turn refetch.
        conversations: isNew
          ? [{ id: conversationId, title: clampTitle(trimmed), lastActivityUtc: nowIso() }, ...s.conversations]
          : s.conversations,
      }))

      await runTurn(conversationId, trimmed, mode)
    },

    async retryLastTurn() {
      const s = get()
      if (s.isBusy) return
      let idx = -1
      for (let i = s.messages.length - 1; i >= 0; i--) {
        if (s.messages[i].isUser) {
          idx = i
          break
        }
      }
      if (idx < 0) return

      const userText = s.messages[idx].content
      const conversationId = s.activeId ?? crypto.randomUUID()
      const assistantMsg = makeMessage({ content: "", isUser: false, streaming: true, processThreadExpanded: true })

      // Drop the failed turn's notice (everything after the user message); a failed
      // turn was never persisted, so re-running against the same history is correct.
      set({
        messages: [...s.messages.slice(0, idx + 1), assistantMsg],
        isBusy: true,
        activeId: conversationId,
        isEphemeral: false,
      })
      await runTurn(conversationId, userText, s.assistantMode)
    },

    stop() {
      if (active) void cancelTurn(active.turnId).catch(() => {})
    },
  }
})
