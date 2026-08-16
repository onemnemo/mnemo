import { useEffect, useRef, useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import type { ChatMessageView, ChatProcessStep } from "../types"
import { Spinner } from "./Spinner"

/**
 * What Soma did before it answered.
 *
 * Two shapes, not one panel that grows. While the turn is running this is the answer, so
 * it is a card you can read. Once the answer arrives it is a receipt, so it folds down to
 * a single line you can ignore, and the card is one click away if you want it.
 *
 * Renders the same ChatProcessStep[] whether live (built by the trace reducer) or
 * reloaded (server-persisted, already resolved).
 */
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

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="mb-2 flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12.5px] text-ink-3 transition-colors hover:bg-frame-hover hover:text-ink-2"
      >
        <span className="truncate">
          {headerText}
          {elapsedText ? <span className="ml-1 font-mono tabular-nums">{elapsedText}</span> : null}
          {summary ? <span> · {summary}</span> : null}
        </span>
        <AppIcon name="chevron-down" size={13} />
      </button>
    )
  }

  return (
    <div className="mb-3 overflow-hidden rounded-xl bg-canvas-sunken/70 shadow-[0_0_0_1px_var(--line-soft)]">
      <button
        type="button"
        onClick={() => setExpanded(false)}
        className="flex h-10 w-full items-center gap-2 px-3 text-left"
      >
        {streaming ? (
          <Spinner className="size-3.5 text-ink-3" />
        ) : (
          <AppIcon name="common/check" size={14} className="text-ink-3" />
        )}
        <span className="flex-1 truncate text-[12.5px] font-medium text-ink-2">{headerText}</span>
        {elapsedText ? <span className="font-mono text-[11.5px] tabular-nums text-ink-3">{elapsedText}</span> : null}
        <AppIcon name="chevron-down" size={13} className="rotate-180 text-ink-3" />
      </button>

      <ol className="px-3 pb-3">
        {hasThoughts ? (
          <TraceItem
            marker={streaming ? <Spinner className="size-3 text-ink-3" /> : <AppIcon name="common/check" size={12} className="text-ink-3" />}
            last={steps.length === 0}
          >
            <span className="text-[12.5px] text-ink-2">{t("Chat", "ThinkingLabel")}</span>
            <p className="mt-1 line-clamp-3 text-[12px] leading-[1.5] text-ink-3">{message.thoughts}</p>
          </TraceItem>
        ) : null}

        {steps.map((step, i) => (
          <StepRow key={i} step={step} last={i === steps.length - 1} />
        ))}
      </ol>
    </div>
  )
}

/**
 * One row of the trace, with the connector rail drawn per item rather than as one line
 * behind the list: a step that expands its detail has to stretch its own segment, and a
 * single absolute rail down the whole list cannot know where the rows ended up.
 */
function TraceItem({
  marker,
  last,
  children,
}: {
  marker: React.ReactNode
  last: boolean
  children: React.ReactNode
}) {
  return (
    <li className={cn("relative pl-6", last ? "pb-0" : "pb-3")}>
      {last ? null : <span aria-hidden className="absolute top-5 bottom-0 left-[7px] w-px bg-line" />}
      <span className="absolute top-0.5 left-0 grid size-3.5 place-items-center rounded-full bg-canvas-sunken">
        {marker}
      </span>
      {children}
    </li>
  )
}

function StepRow({ step, last }: { step: ChatProcessStep; last: boolean }) {
  const [open, setOpen] = useState(false)
  const tool = step.toolCalls?.[0] ?? null
  const isNarration = step.phaseKind === "Narration"
  const expandable = !!tool && (!!tool.arguments || !!tool.result)

  if (isNarration) {
    return (
      <li className={cn("pl-6", last ? "pb-0" : "pb-3")}>
        <p className="line-clamp-3 text-[12px] leading-[1.5] text-ink-3 italic">{step.narration}</p>
      </li>
    )
  }

  return (
    <TraceItem
      last={last}
      marker={
        step.isComplete ? (
          <AppIcon name="common/check" size={12} className="text-ink-3" />
        ) : (
          <Spinner className="size-3 text-ink-2" />
        )
      }
    >
      <button
        type="button"
        disabled={!expandable}
        onClick={() => setOpen((v) => !v)}
        className={cn("flex w-full items-center gap-1.5 text-left", expandable && "cursor-pointer")}
      >
        <span className={cn("text-[12.5px]", step.isComplete ? "text-ink-2" : "text-ink")}>{step.label}</span>
        {step.detail ? (
          <span className="truncate rounded bg-accent-wash px-1.5 py-0.5 font-mono text-[11px] text-accent-ink">
            {step.detail}
          </span>
        ) : null}
        {tool?.summary ? <span className="truncate text-[11.5px] text-ink-3">· {tool.summary}</span> : null}
      </button>

      {expandable && open ? (
        <div className="mt-1.5 space-y-1 overflow-hidden rounded-lg bg-canvas p-2 shadow-[0_0_0_1px_var(--line-soft)]">
          {tool?.arguments ? (
            <pre className="overflow-x-auto font-mono text-[11px] whitespace-pre-wrap text-ink-3">{tool.arguments}</pre>
          ) : null}
          {tool?.result ? (
            <pre className="max-h-40 overflow-auto font-mono text-[11px] whitespace-pre-wrap text-ink-2">
              {tool.result}
            </pre>
          ) : null}
        </div>
      ) : null}
    </TraceItem>
  )
}
