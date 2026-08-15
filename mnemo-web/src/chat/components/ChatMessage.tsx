import { useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"
import { toast } from "@/stores/toast"

import { useChatStore } from "../store"
import type { ChatMessageView } from "../types"
import { MessageAttachments } from "./Attachment"
import { ChatTracePanel } from "./ChatTracePanel"
import { FailureNotice } from "./FailureNotice"
import { Markdown } from "./Markdown"
import { SomaMark } from "./SomaMark"

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
  const copy = () => copyToClipboard(message.content, t("Common", "Copied"))

  if (editing) {
    return (
      <div className="flex justify-end">
        <div className="w-full max-w-[560px] rounded-2xl bg-canvas p-2 shadow-[0_0_0_1.5px_var(--solid)]">
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
            className="block w-full resize-none bg-transparent px-2 py-1.5 text-[14px] leading-[1.6] text-ink focus:outline-none"
          />
          {/* Editing is not a correction here, it is a re-ask, and the reply that is
              already on screen disappears. Saying so costs one line. */}
          <div className="mt-1 flex items-center gap-2 px-2">
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-3">{t("Chat", "EditSendNote")}</span>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="h-7 rounded-lg px-2.5 text-[12.5px] text-ink-2 transition-colors hover:bg-frame-hover"
            >
              {t("Common", "Cancel")}
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!draft.trim()}
              className="h-7 rounded-lg bg-solid px-2.5 text-[12.5px] text-solid-fg transition-colors hover:bg-solid-hover disabled:opacity-40"
            >
              {t("Chat", "SaveAndSubmit")}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="group/user flex flex-col items-end gap-1">
      {message.attachments && message.attachments.length > 0 ? (
        <MessageAttachments attachments={message.attachments} />
      ) : null}
      {message.content ? (
        <div className="max-w-[560px] rounded-2xl bg-canvas-sunken px-3.5 py-2.5 text-[14px] leading-[1.6] whitespace-pre-wrap text-ink">
          {message.content}
        </div>
      ) : null}
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/user:opacity-100 focus-within:opacity-100">
        <MessageAction icon="common/copy" label={t("Chat", "CopyMessage")} onClick={copy} />
        {onEdit && !isBusy ? (
          <MessageAction icon="common/pencil" label={t("Chat", "EditMessage")} onClick={begin} />
        ) : null}
      </div>
    </div>
  )
}

function AssistantMessage({ index, isLast, message, onRetry, onSuggestion, onRegenerate }: ChatMessageProps) {
  const streaming = message.streaming === true
  const awaitingFirstToken = streaming && message.content.length === 0 && !message.notice
  const showBody = message.content.length > 0 && !message.notice
  const showActions = !streaming && !message.notice

  return (
    <div className="group/assistant flex gap-3">
      {/* A gutter mark rather than a bubble: the reply is the page's prose, and boxing it
          would make every answer look like a quotation of itself. */}
      <SomaMark size={22} className="mt-0.5" />

      <div className="min-w-0 flex-1">
        <ChatTracePanel message={message} />

        {awaitingFirstToken ? <AnswerSkeleton /> : null}

        {message.notice ? <FailureNotice notice={message.notice} onRetry={onRetry} /> : null}

        {showBody ? <Markdown content={message.content} streaming={streaming} /> : null}

        {message.sources && message.sources.length > 0 ? <Sources sources={message.sources} /> : null}

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
    </div>
  )
}

function AnswerSkeleton() {
  return (
    <div className="flex flex-col gap-2 py-1">
      <div className="h-3 w-2/5 animate-pulse rounded bg-frame-active" />
      <div className="h-3 w-4/5 animate-pulse rounded bg-frame-active" />
      <div className="h-3 w-3/5 animate-pulse rounded bg-frame-active" />
    </div>
  )
}

function Sources({ sources }: { sources: string[] }) {
  const t = useT()
  return (
    <div className="mt-4">
      <div className="mb-1.5 text-[11px] font-semibold tracking-[0.04em] text-ink-3 uppercase">
        {t("Chat", "SourcesLabel")}
      </div>
      {/* Cards, not chips: a source is a thing you might open, and a row of pills reads as
          a set of filters. */}
      <div className="grid gap-1.5 sm:grid-cols-2">
        {sources.map((source, i) => (
          <div
            key={i}
            className="flex min-w-0 items-center gap-2 rounded-lg bg-canvas-sunken px-2.5 py-2 text-[12.5px] text-ink-2"
          >
            <AppIcon name="common/globe" size={13} className="shrink-0 text-ink-3" />
            <span className="truncate">{source}</span>
          </div>
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
          className="h-8 rounded-lg px-2.5 text-[12.5px] text-ink-2 shadow-[0_0_0_1px_var(--line-soft)] transition-colors hover:bg-frame-hover hover:text-ink"
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
  // Clicking the active vote clears it (toggle); otherwise it replaces the other.
  const vote = (value: number) => setFeedback(index, feedback === value ? 0 : value)

  return (
    <div className="mt-2 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/assistant:opacity-100 focus-within:opacity-100">
      <MessageAction
        icon="common/thumbs-up"
        label={t("Chat", "GoodResponse")}
        active={feedback === 1}
        onClick={() => vote(1)}
      />
      <MessageAction
        icon="common/thumbs-down"
        label={t("Chat", "BadResponse")}
        active={feedback === 2}
        onClick={() => vote(2)}
      />
      <span aria-hidden className="mx-1 h-4 w-px bg-line-soft" />
      <MessageAction
        icon="common/copy"
        label={t("Chat", "CopyMessage")}
        onClick={() => copyToClipboard(content, t("Common", "Copied"))}
      />
      {onRegenerate ? (
        <MessageAction icon="common/refresh" label={t("Chat", "Regenerate")} onClick={onRegenerate} />
      ) : null}
    </div>
  )
}

function copyToClipboard(text: string, confirmation: string) {
  void navigator.clipboard?.writeText(text).then(
    () => toast.success(confirmation),
    () => {},
  )
}

function MessageAction({
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
        "grid size-7 place-items-center rounded-md transition-colors hover:bg-frame-hover",
        active ? "text-accent-ink" : "text-ink-3 hover:text-ink",
      )}
    >
      <AppIcon name={icon} size={14} />
    </button>
  )
}
