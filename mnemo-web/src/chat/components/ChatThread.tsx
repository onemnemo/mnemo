import { useEffect, useRef, useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"

import type { ChatMessageView } from "../types"
import { ChatMessage } from "./ChatMessage"

interface ChatThreadProps {
  messages: ChatMessageView[]
  onRetry: () => void
  onSuggestion: (text: string) => void
}

const BOTTOM_THRESHOLD = 24

export function ChatThread({ messages, onRetry, onSuggestion }: ChatThreadProps) {
  const t = useT()
  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [showFab, setShowFab] = useState(false)

  const last = messages[messages.length - 1]
  // Re-scroll on any growth: new message, streamed content, or a new trace step.
  const growthSignal = `${messages.length}:${last?.content.length ?? 0}:${last?.processSteps?.length ?? 0}`

  useEffect(() => {
    const el = scrollRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [growthSignal])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.clientHeight - el.scrollTop <= BOTTOM_THRESHOLD
    stick.current = atBottom
    setShowFab(!atBottom)
  }

  const scrollToBottom = () => {
    const el = scrollRef.current
    if (!el) return
    stick.current = true
    el.scrollTop = el.scrollHeight
    setShowFab(false)
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} onScroll={handleScroll} className="h-full overflow-y-auto">
        <div className="mx-auto flex max-w-[700px] flex-col gap-6 px-6 py-8">
          {messages.map((message, i) => (
            <ChatMessage key={i} message={message} onRetry={onRetry} onSuggestion={onSuggestion} />
          ))}
        </div>
      </div>

      {showFab ? (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label={t("Chat", "ScrollToBottom")}
          title={t("Chat", "ScrollToBottom")}
          className="absolute bottom-4 left-1/2 grid size-9 -translate-x-1/2 place-items-center rounded-full border border-line bg-popover text-text-secondary shadow-[var(--elevation-2)] transition-colors hover:text-foreground"
        >
          <AppIcon name="common/arrow-down" size={16} />
        </button>
      ) : null}
    </div>
  )
}
