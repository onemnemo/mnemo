import { useEffect, useState } from "react"

import { useT } from "@/i18n/useT"

import { useChatStore } from "../store"
import { ChatComposer } from "./ChatComposer"
import { ChatHistorySidebar } from "./ChatHistorySidebar"
import { ChatLanding } from "./ChatLanding"
import { ChatThread } from "./ChatThread"

// Atlas: the chat history sidebar plus the conversation surface (landing greeting
// or the streaming thread with a docked composer). One store owns the turn flow.
export function ChatPage() {
  const t = useT()
  const [input, setInput] = useState("")
  const [historyCollapsed, setHistoryCollapsed] = useState(false)

  const init = useChatStore((s) => s.init)
  const messages = useChatStore((s) => s.messages)
  const isBusy = useChatStore((s) => s.isBusy)
  const mode = useChatStore((s) => s.assistantMode)
  const webSearch = useChatStore((s) => s.webSearchEnabled)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const stop = useChatStore((s) => s.stop)
  const setMode = useChatStore((s) => s.setMode)
  const setWebSearch = useChatStore((s) => s.setWebSearch)
  const retryLastTurn = useChatStore((s) => s.retryLastTurn)

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
      webSearch={webSearch}
      onWebSearchChange={setWebSearch}
      placeholder={showLanding ? undefined : t("Chat", "FollowUpPlaceholder")}
      autoFocus
    />
  )

  return (
    <div className="flex h-full min-h-0">
      <ChatHistorySidebar collapsed={historyCollapsed} onToggle={() => setHistoryCollapsed((c) => !c)} />

      <div className="flex min-w-0 flex-1 flex-col">
        {showLanding ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ChatLanding composer={composer} onQuickAction={quickAction} />
          </div>
        ) : (
          <>
            <ChatThread messages={messages} onRetry={() => void retryLastTurn()} onSuggestion={setInput} />
            <div className="border-t border-line px-6 py-3">
              <div className="mx-auto max-w-[700px]">
                {composer}
                <p className="mt-1.5 text-center text-caption text-text-faded">{t("Chat", "Disclaimer")}</p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
