import { useEffect, useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"

import { QUICK_ACTIONS } from "../quick-actions"
import { useChatStore } from "../store"
import { ChatComposer } from "./ChatComposer"
import { ChatThread } from "./ChatThread"
import { SomaMark } from "./SomaMark"

/** The dock is narrow, so it offers a couple of starting points rather than the full set. */
const DOCK_QUICK_ACTIONS = QUICK_ACTIONS.slice(0, 2)

/**
 * The dock's conversation, on the same store as the full page.
 *
 * No history list and no thread header: the dock is for the question you have right now
 * about the thing you are looking at. Everything you would need a list for is one click
 * away in Soma itself.
 */
export function SomaDockBody() {
  const t = useT()
  const [input, setInput] = useState("")

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

  const showEmpty = !messages.some((m) => m.isUser)

  const doSend = () => {
    const text = input.trim()
    if (!text || isBusy) return
    setInput("")
    void sendMessage(text)
  }

  const send = (prompt: string) => {
    if (isBusy) return
    setInput("")
    void sendMessage(prompt)
  }

  return (
    <>
      {showEmpty ? (
        <div className="flex min-h-0 flex-1 flex-col justify-end gap-3 px-3 pb-2">
          <SomaMark size={26} />
          <p className="text-[13px] leading-[1.55] text-ink-2">{t("Chat", "DockIntro")}</p>
          <div className="flex flex-col gap-1.5">
            {DOCK_QUICK_ACTIONS.map((action) => (
              <button
                key={action.titleKey}
                type="button"
                onClick={() => send(t("Chat", action.promptKey))}
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] text-ink-2 shadow-[0_0_0_1px_var(--line-soft)] transition-colors hover:bg-frame-hover hover:text-ink"
              >
                <AppIcon name={action.icon} size={14} className="shrink-0 text-ink-3" />
                <span className="truncate">{t("Chat", action.titleKey)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <ChatThread
          compact
          messages={messages}
          onRetry={() => void retryLastTurn()}
          onSuggestion={setInput}
          onRegenerate={() => void regenerateLastTurn()}
          onEdit={(index, text) => void editAndResend(index, text)}
        />
      )}

      <div className="shrink-0 px-2.5 pt-2 pb-2.5">
        <ChatComposer
          compact
          value={input}
          onChange={setInput}
          onSend={doSend}
          onStop={stop}
          isBusy={isBusy}
          mode={mode}
          onModeChange={setMode}
          placeholder={t("Chat", "DockPlaceholder")}
        />
      </div>
    </>
  )
}
