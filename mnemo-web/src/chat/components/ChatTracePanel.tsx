import { useEffect, useRef, useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import type { ChatMessageView, ChatProcessStep } from "../types"
import { Spinner } from "./Spinner"

// The process-trace disclosure above an assistant answer. Auto-expands while
// streaming and auto-collapses ~600ms after the turn finishes (matching the
// desktop). Renders the same ChatProcessStep[] whether live (built by the trace
// reducer) or reloaded (server-persisted, already resolved).
const AUTO_COLLAPSE_MS = 600

function formatRunningTimer(startIso: string): string {
  const started = Date.parse(startIso)
  const seconds = Number.isNaN(started) ? 0 : Math.max(0, Math.floor((Date.now() - started) / 1000))
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0")
  const ss = String(seconds % 60).padStart(2, "0")
  return `${mm}:${ss}`
}

export function ChatTracePanel({ message }: { message: ChatMessageView }) {
  const t = useT()
  const streaming = message.streaming === true
  // "Writing/continuing the answer" are answer bookkeeping, never shown, the live
  // reducer never emits them, and the desktop drops them from persisted history on
  // reload, so filter them here to keep live and reloaded traces identical.
  const steps = (message.processSteps ?? []).filter((s) => s.phaseKind !== "Generating" && s.phaseKind !== "Continuing")
  const hasThoughts = !!message.thoughts && message.thoughts.trim().length > 0
  const hasTrace = steps.length > 0 || hasThoughts

  const [expanded, setExpanded] = useState(streaming || message.processThreadExpanded === true)
  const wasStreaming = useRef(streaming)
  const [, forceTick] = useState(0)

  // Auto-collapse once streaming ends (fires regardless of a manual re-expand, as the desktop does).
  useEffect(() => {
    if (wasStreaming.current && !streaming) {
      const id = setTimeout(() => setExpanded(false), AUTO_COLLAPSE_MS)
      wasStreaming.current = streaming
      return () => clearTimeout(id)
    }
    wasStreaming.current = streaming
  }, [streaming])

  // Tick the running timer once a second while streaming.
  useEffect(() => {
    if (!streaming) return
    const id = setInterval(() => forceTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [streaming])

  if (!hasTrace) return null

  const headerText = streaming ? t("Chat", "WorkingOnIt") : (message.processHeaderText ?? t("Chat", "ThoughtFor"))
  const elapsedText = streaming ? formatRunningTimer(message.timestampUtc) : (message.elapsedText ?? "")
  const summary = !streaming ? message.processSummaryText : null

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="group flex items-center gap-2 text-body-small text-text-tertiary transition-colors hover:text-text-secondary"
      >
        {streaming ? (
          <Spinner className="size-3.5 text-text-tertiary" />
        ) : (
          <AppIcon name="common/check" size={14} className="text-text-faded" />
        )}
        <span>
          {headerText}
          {elapsedText ? <span className="ml-1 font-mono text-text-faded">{elapsedText}</span> : null}
          {summary ? <span className="text-text-faded"> · {summary}</span> : null}
        </span>
        <AppIcon
          name="common/chevron-down"
          size={14}
          className={cn("text-text-faded transition-transform", expanded && "rotate-180")}
        />
      </button>

      {expanded ? (
        <div className="mt-2 ml-1 border-l border-line pl-3">
          {hasThoughts ? (
            <div className="mb-2 flex gap-2">
              {streaming ? (
                <Spinner className="mt-0.5 size-3 text-text-faded" />
              ) : (
                <AppIcon name="common/check" size={12} className="mt-0.5 text-text-faded" />
              )}
              <div className="min-w-0">
                <div className="text-body-extra-small font-medium text-text-secondary">{t("Chat", "ThinkingLabel")}</div>
                <p className="line-clamp-2 text-body-extra-small text-text-tertiary">{message.thoughts}</p>
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            {steps.map((step, i) => (
              <StepRow key={i} step={step} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function StepRow({ step }: { step: ChatProcessStep }) {
  const [open, setOpen] = useState(false)
  const tool = step.toolCalls?.[0] ?? null
  const isNarration = step.phaseKind === "Narration"
  const expandable = !!tool && (!!tool.arguments || !!tool.result)

  if (isNarration) {
    return <p className="line-clamp-3 pl-5 text-body-extra-small text-text-faded italic">{step.narration}</p>
  }

  return (
    <div>
      <button
        type="button"
        disabled={!expandable}
        onClick={() => setOpen((v) => !v)}
        className={cn("flex w-full items-center gap-2 text-left", expandable && "cursor-pointer")}
      >
        {step.isComplete ? (
          <AppIcon name="common/check" size={12} className="shrink-0 text-text-faded" />
        ) : (
          <Spinner className="size-3 text-text-tertiary" />
        )}
        <span className={cn("text-body-extra-small", step.isComplete ? "text-text-secondary" : "text-foreground")}>
          {step.label}
        </span>
        {step.detail ? (
          <span className="truncate rounded bg-surface-subtle px-1.5 py-0.5 font-mono text-micro text-text-tertiary">
            {step.detail}
          </span>
        ) : null}
        {tool?.summary ? <span className="text-micro text-text-faded">· {tool.summary}</span> : null}
      </button>

      {expandable && open ? (
        <div className="mt-1 ml-5 space-y-1 overflow-hidden rounded-md border border-line bg-surface-subtle p-2">
          {tool?.arguments ? (
            <pre className="overflow-x-auto font-mono text-micro whitespace-pre-wrap text-text-tertiary">
              {tool.arguments}
            </pre>
          ) : null}
          {tool?.result ? (
            <pre className="max-h-40 overflow-auto font-mono text-micro whitespace-pre-wrap text-text-secondary">
              {tool.result}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
