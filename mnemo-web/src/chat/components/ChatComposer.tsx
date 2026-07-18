import { useEffect, useRef } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { ASSISTANT_MODES, type AssistantMode } from "../types"

interface ChatComposerProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  isBusy: boolean
  mode: AssistantMode
  onModeChange: (mode: AssistantMode) => void
  webSearch: boolean
  onWebSearchChange: (enabled: boolean) => void
  placeholder?: string
  autoFocus?: boolean
}

const MAX_HEIGHT = 180

export function ChatComposer({
  value,
  onChange,
  onSend,
  onStop,
  isBusy,
  mode,
  onModeChange,
  webSearch,
  onWebSearchChange,
  placeholder,
  autoFocus,
}: ChatComposerProps) {
  const t = useT()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Grow with content, then scroll past MAX_HEIGHT.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`
  }, [value])

  const canSend = value.trim().length > 0 && !isBusy

  const submit = () => {
    if (canSend) onSend()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter") return
    // Ctrl/Cmd+Enter inserts a newline (desktop parity); Shift+Enter does too
    // (the web convention) via the textarea's default. Plain Enter sends.
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const el = e.currentTarget
      const start = el.selectionStart
      const end = el.selectionEnd
      const next = `${value.slice(0, start)}\n${value.slice(end)}`
      onChange(next)
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 1
      })
      return
    }
    if (!e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="rounded-xl border border-input bg-[var(--text-control-background)] p-2 transition-colors focus-within:border-[var(--text-control-border-focused)]">
      <textarea
        ref={textareaRef}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        placeholder={placeholder ?? t("Chat", "LandingPlaceholder")}
        className="block max-h-[180px] w-full resize-none bg-transparent px-2 py-1.5 text-body-medium text-foreground placeholder:text-text-faded focus:outline-none"
      />

      <div className="mt-1 flex items-center gap-2">
        <ToolbarToggle
          icon="common/globe"
          label={t("Chat", "WebSearch")}
          active={webSearch}
          onClick={() => onWebSearchChange(!webSearch)}
        />

        <div className="ml-auto flex items-center gap-2">
          <ModeSegments mode={mode} onModeChange={onModeChange} />
          {isBusy ? (
            <button
              type="button"
              onClick={onStop}
              title={t("Chat", "Stop")}
              aria-label={t("Chat", "Stop")}
              className="grid size-8 place-items-center rounded-full bg-brand text-primary-foreground transition-opacity hover:opacity-90"
            >
              <AppIcon name="common/stop" size={14} />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              title={t("Chat", "SendEnter")}
              aria-label={t("Chat", "SendEnter")}
              className="grid size-8 place-items-center rounded-full bg-brand text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <AppIcon name="common/arrow-up" size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ToolbarToggle({
  icon,
  label,
  active,
  onClick,
}: {
  icon: string
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={label}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-body-small transition-colors",
        active
          ? "bg-brand-subtle text-brand"
          : "text-text-tertiary hover:bg-surface-subtle hover:text-text-secondary",
      )}
    >
      <AppIcon name={icon} size={15} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

function ModeSegments({ mode, onModeChange }: { mode: AssistantMode; onModeChange: (mode: AssistantMode) => void }) {
  const t = useT()
  const labelKey: Record<AssistantMode, string> = {
    Short: "AssistantModeShort",
    Normal: "AssistantModeNormal",
    Detailed: "AssistantModeDetailed",
  }
  return (
    <div className="flex items-center rounded-lg bg-surface-subtle p-0.5" role="radiogroup" aria-label={t("Chat", "AssistantMode")}>
      {ASSISTANT_MODES.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          onClick={() => onModeChange(m)}
          className={cn(
            "rounded-md px-2 py-1 text-body-extra-small font-medium transition-colors",
            mode === m ? "bg-surface text-foreground shadow-[var(--elevation-1)]" : "text-text-tertiary hover:text-text-secondary",
          )}
        >
          {t("Chat", labelKey[m])}
        </button>
      ))}
    </div>
  )
}
