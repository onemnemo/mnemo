import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"
import { toast } from "@/stores/toast"

import { useChatStore } from "../store"
import type { ChatMessageView } from "../types"
import { ChatTracePanel } from "./ChatTracePanel"
import { FailureNotice } from "./FailureNotice"
import { Markdown } from "./Markdown"

interface ChatMessageProps {
  index: number
  message: ChatMessageView
  onRetry?: () => void
  onSuggestion?: (text: string) => void
}

export function ChatMessage({ index, message, onRetry, onSuggestion }: ChatMessageProps) {
  if (message.isUser) return <UserMessage message={message} />
  return <AssistantMessage index={index} message={message} onRetry={onRetry} onSuggestion={onSuggestion} />
}

function UserMessage({ message }: { message: ChatMessageView }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[560px] rounded-xl bg-card px-4 py-2.5 text-body-medium whitespace-pre-wrap text-foreground">
        {message.content}
      </div>
    </div>
  )
}

function AssistantMessage({ index, message, onRetry, onSuggestion }: ChatMessageProps) {
  const streaming = message.streaming === true
  const awaitingFirstToken = streaming && message.content.length === 0 && !message.notice
  const showBody = message.content.length > 0 && !message.notice
  const showActions = !streaming && !message.notice

  return (
    <div className="min-w-0">
      <ChatTracePanel message={message} />

      {awaitingFirstToken ? <AnswerSkeleton /> : null}

      {message.notice ? <FailureNotice notice={message.notice} onRetry={onRetry} /> : null}

      {showBody ? <Markdown content={message.content} streaming={streaming} /> : null}

      {message.sources && message.sources.length > 0 ? <SourceChips sources={message.sources} /> : null}

      {message.suggestions && message.suggestions.length > 0 ? (
        <Suggestions suggestions={message.suggestions} onSuggestion={onSuggestion} />
      ) : null}

      {showActions ? <ActionBar index={index} content={message.content} feedback={message.feedback} /> : null}
    </div>
  )
}

function AnswerSkeleton() {
  return (
    <div className="flex flex-col gap-2 py-1">
      <div className="h-3 w-2/5 animate-pulse rounded bg-surface-subtle" />
      <div className="h-3 w-4/5 animate-pulse rounded bg-surface-subtle" />
      <div className="h-3 w-3/5 animate-pulse rounded bg-surface-subtle" />
    </div>
  )
}

function SourceChips({ sources }: { sources: string[] }) {
  const t = useT()
  return (
    <div className="mt-3">
      <div className="mb-1 text-body-extra-small font-medium text-text-tertiary">{t("Chat", "SourcesLabel")}</div>
      <div className="flex flex-wrap gap-1.5">
        {sources.map((source, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-subtle px-2 py-0.5 text-body-extra-small text-text-secondary"
          >
            <AppIcon name="common/globe" size={12} className="text-text-faded" />
            {source}
          </span>
        ))}
      </div>
    </div>
  )
}

function Suggestions({ suggestions, onSuggestion }: { suggestions: string[]; onSuggestion?: (text: string) => void }) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {suggestions.map((suggestion, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onSuggestion?.(suggestion)}
          className="rounded-full border border-line px-3 py-1 text-body-small text-text-secondary transition-colors hover:bg-surface-subtle hover:text-foreground"
        >
          {suggestion}
        </button>
      ))}
    </div>
  )
}

function ActionBar({ index, content, feedback }: { index: number; content: string; feedback: number }) {
  const t = useT()
  const setFeedback = useChatStore((s) => s.setFeedback)
  const copy = () => {
    void navigator.clipboard?.writeText(content).then(
      () => toast.success(t("Common", "Copied")),
      () => {},
    )
  }
  // Clicking the active vote clears it (toggle); otherwise it replaces the other.
  const vote = (value: number) => setFeedback(index, feedback === value ? 0 : value)

  return (
    <div className="mt-2 flex items-center gap-1">
      <ActionButton icon="common/copy" label={t("Chat", "CopyMessage")} onClick={copy} />
      <ActionButton
        icon="common/thumbs-up"
        label={t("Chat", "GoodResponse")}
        active={feedback === 1}
        onClick={() => vote(1)}
      />
      <ActionButton
        icon="common/thumbs-down"
        label={t("Chat", "BadResponse")}
        active={feedback === 2}
        onClick={() => vote(2)}
      />
    </div>
  )
}

function ActionButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: string
  label: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "grid size-7 place-items-center rounded-md transition-colors hover:bg-surface-subtle",
        active ? "text-brand" : "text-text-tertiary hover:text-text-primary",
      )}
    >
      <AppIcon name={icon} size={14} />
    </button>
  )
}
