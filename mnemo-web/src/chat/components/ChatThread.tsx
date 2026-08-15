import { useEffect, useRef, useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import type { ChatMessageView } from "../types"
import { ChatMessage } from "./ChatMessage"

interface ChatThreadProps {
  messages: ChatMessageView[]
  onRetry: () => void
  onSuggestion: (text: string) => void
  onRegenerate: () => void
  onEdit: (index: number, text: string) => void
  /** The dock's variant: the pane is already narrow, so it sets its own measure. */
  compact?: boolean
}

const BOTTOM_THRESHOLD = 24

/** The reading measure for a conversation. Wider than this and the eye loses the line. */
export const THREAD_MEASURE = 720

export function ChatThread({ messages, onRetry, onSuggestion, onRegenerate, onEdit, compact }: ChatThreadProps) {
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
      <div ref={scrollRef} onScroll={handleScroll} className="scroll-thin h-full overflow-y-auto">
        <div
          className={cn("mx-auto flex flex-col gap-6", compact ? "px-3 py-4" : "px-6 py-8")}
          style={compact ? undefined : { maxWidth: THREAD_MEASURE }}
        >
          {messages.map((message, i) => (
            <ChatMessage
              key={i}
              index={i}
              isLast={i === messages.length - 1}
              message={message}
              onRetry={onRetry}
              onSuggestion={onSuggestion}
              onRegenerate={onRegenerate}
              onEdit={onEdit}
            />
          ))}
        </div>
      </div>

      {/* A labelled pill rather than a bare arrow. It only appears when you have scrolled
          away from a conversation that is still moving, and at that moment the useful word
          is what it takes you back to. */}
      {showFab ? (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label={t("Chat", "ScrollToBottom")}
          className="animate-rise absolute bottom-3 left-1/2 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full bg-canvas px-3 text-[12.5px] text-ink-2 shadow-pop transition-colors hover:text-ink"
        >
          {t("Chat", "Latest")}
          <AppIcon name="common/arrow-down" size={13} />
        </button>
      ) : null}
    </div>
  )
}
