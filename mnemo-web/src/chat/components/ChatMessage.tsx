import { useState } from "react"

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
  isLast?: boolean
  message: ChatMessageView
  onRetry?: () => void
  onSuggestion?: (text: string) => void
  onRegenerate?: () => void
  onEdit?: (index: number, text: string) => void
}

export function ChatMessage({ index, isLast, message, onRetry, onSuggestion, onRegenerate, onEdit }: ChatMessageProps) {
  if (message.isUser) return <UserMessage index={index} message={message} onEdit={onEdit} />
  return (
    <AssistantMessage
      index={index}
      isLast={isLast}
      message={message}
      onRetry={onRetry}
      onSuggestion={onSuggestion}
      onRegenerate={onRegenerate}
    />
  )
}

function UserMessage({
  index,
  message,
  onEdit,
}: {
  index: number
  message: ChatMessageView
  onEdit?: (index: number, text: string) => void
}) {
  const t = useT()
  const isBusy = useChatStore((s) => s.isBusy)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)

  const begin = () => {
    setDraft(message.content)
    setEditing(true)
  }
  const submit = () => {
    const text = draft.trim()
    if (!text) return
    setEditing(false)
    onEdit?.(index, text)
  }

  if (editing) {
    return (
      <div className="flex justify-end">
        <div className="w-full max-w-[560px] rounded-xl border border-input bg-[var(--text-control-background)] p-2 focus-within:border-[var(--text-control-border-focused)]">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault()
                setEditing(false)
              } else if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            rows={Math.min(8, draft.split("\n").length)}
            className="block w-full resize-none bg-transparent px-2 py-1.5 text-body-medium text-foreground focus:outline-none"
          />
          <div className="mt-1 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-lg px-3 py-1 text-body-small text-text-tertiary transition-colors hover:text-text-secondary"
            >
              {t("Common", "Cancel")}
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!draft.trim()}
              className="rounded-lg bg-brand px-3 py-1 text-body-small text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {t("Common", "Save")}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="group flex flex-col items-end gap-1">
      <div className="max-w-[560px] rounded-xl bg-card px-4 py-2.5 text-body-medium whitespace-pre-wrap text-foreground">
        {message.content}
      </div>
      {onEdit && !isBusy ? (
        <button
          type="button"
          onClick={begin}
          title={t("Chat", "EditMessage")}
          aria-label={t("Chat", "EditMessage")}
          className="grid size-7 place-items-center rounded-md text-text-tertiary opacity-0 transition hover:bg-surface-subtle hover:text-text-primary group-hover:opacity-100"
        >
          <AppIcon name="common/pencil" size={13} />
        </button>
      ) : null}
    </div>
  )
}

function AssistantMessage({ index, isLast, message, onRetry, onSuggestion, onRegenerate }: ChatMessageProps) {
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

      {showActions ? (
        <ActionBar
          index={index}
          content={message.content}
          feedback={message.feedback}
          onRegenerate={isLast ? onRegenerate : undefined}
        />
      ) : null}
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

function ActionBar({
  index,
  content,
  feedback,
  onRegenerate,
}: {
  index: number
  content: string
  feedback: number
  onRegenerate?: () => void
}) {
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
      {onRegenerate ? (
        <ActionButton icon="common/refresh" label={t("Chat", "Regenerate")} onClick={onRegenerate} />
      ) : null}
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
