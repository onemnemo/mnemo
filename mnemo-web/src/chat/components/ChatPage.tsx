import { useEffect, useState } from "react"

import { useT } from "@/i18n/useT"

import { useChatStore } from "../store"
import { ChatComposer } from "./ChatComposer"
import { ChatHistorySidebar } from "./ChatHistorySidebar"
import { ChatLanding } from "./ChatLanding"
import { ChatThread, THREAD_MEASURE } from "./ChatThread"
import { ChatThreadHeader } from "./ChatThreadHeader"

// Soma's full surface: the conversation list beside either the empty state or a running
// thread with the composer docked under it. One store owns the turn flow, shared with the
// dock, so a conversation started in one is the conversation you find in the other.

/** The composer is inset from the thread's measure so it does not read as another message. */
const COMPOSER_MEASURE = THREAD_MEASURE - 64

export function ChatPage() {
  const t = useT()
  const [input, setInput] = useState("")
  const [historyCollapsed, setHistoryCollapsed] = useState(false)

  const init = useChatStore((s) => s.init)
  const messages = useChatStore((s) => s.messages)
  const isBusy = useChatStore((s) => s.isBusy)
  const mode = useChatStore((s) => s.assistantMode)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const stop = useChatStore((s) => s.stop)
  const setMode = useChatStore((s) => s.setMode)
  const retryLastTurn = useChatStore((s) => s.retryLastTurn)
  const regenerateLastTurn = useChatStore((s) => s.regenerateLastTurn)
  const editAndResend = useChatStore((s) => s.editAndResend)

  useEffect(() => {
    void init()
  }, [init])

  const showLanding = !messages.some((m) => m.isUser)

  const doSend = () => {
    const text = input.trim()
    if (!text || isBusy) return
    setInput("")
    void sendMessage(text)
  }

  const quickAction = (prompt: string) => {
    if (isBusy) return
    setInput("")
    void sendMessage(prompt)
  }

  const composer = (
    <ChatComposer
      value={input}
      onChange={setInput}
      onSend={doSend}
      onStop={stop}
      isBusy={isBusy}
      mode={mode}
      onModeChange={setMode}
      placeholder={showLanding ? undefined : t("Chat", "FollowUpPlaceholder")}
      autoFocus
    />
  )

  return (
    <div className="flex h-full min-h-0 bg-canvas">
      <ChatHistorySidebar collapsed={historyCollapsed} onToggle={() => setHistoryCollapsed((c) => !c)} />

      <div className="flex min-w-0 flex-1 flex-col">
        {showLanding ? (
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
            <ChatLanding composer={composer} onQuickAction={quickAction} />
          </div>
        ) : (
          <>
            <ChatThreadHeader />
            <ChatThread
              messages={messages}
              onRetry={() => void retryLastTurn()}
              onSuggestion={setInput}
              onRegenerate={() => void regenerateLastTurn()}
              onEdit={(index, text) => void editAndResend(index, text)}
            />
            <div className="px-6 pb-4">
              <div className="mx-auto" style={{ maxWidth: COMPOSER_MEASURE }}>
                {composer}
                <p className="mt-2 text-center text-[11px] text-ink-3">{t("Chat", "Disclaimer")}</p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
