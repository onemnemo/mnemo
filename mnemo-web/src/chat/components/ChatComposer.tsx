import { useEffect, useRef } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@/components/ui/menu"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { useChatStore } from "../store"
import { ASSISTANT_MODES, type AssistantMode } from "../types"
import { PendingAttachments } from "./Attachment"
import { ToolsFlyout } from "./ToolsFlyout"

interface ChatComposerProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  isBusy: boolean
  mode: AssistantMode
  onModeChange: (mode: AssistantMode) => void
  placeholder?: string
  autoFocus?: boolean
  /** The dock's variant: no room for the response-length picker beside everything else. */
  compact?: boolean
}

const MAX_HEIGHT = 200

const MODE_LABEL_KEYS: Record<AssistantMode, string> = {
  Short: "AssistantModeShort",
  Normal: "AssistantModeNormal",
  Detailed: "AssistantModeDetailed",
}

/**
 * The one place a message is written, on every Soma surface.
 *
 * Drawn as a single field rather than a bordered box with a toolbar under it: the
 * controls belong to the message being written, so they sit inside its outline and the
 * whole thing lights up together on focus.
 */
export function ChatComposer({
  value,
  onChange,
  onSend,
  onStop,
  isBusy,
  mode,
  onModeChange,
  placeholder,
  autoFocus,
  compact,
}: ChatComposerProps) {
  const t = useT()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const pendingAttachments = useChatStore((s) => s.pendingAttachments)
  const uploadingCount = useChatStore((s) => s.uploadingCount)
  const addAttachments = useChatStore((s) => s.addAttachments)
  const removeAttachment = useChatStore((s) => s.removeAttachment)

  // Grow with content, then scroll past MAX_HEIGHT.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`
  }, [value])

  const uploading = uploadingCount > 0
  const canSend = value.trim().length > 0 && !isBusy && !uploading

  const onFilesPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) void addAttachments(e.target.files)
    e.target.value = "" // let the same file be re-picked later
  }

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
    <div className="rounded-2xl bg-canvas p-2 shadow-[0_0_0_1px_var(--line)] transition-shadow focus-within:shadow-[0_0_0_1.5px_var(--line)]">
      <PendingAttachments attachments={pendingAttachments} onRemove={removeAttachment} />

      <input ref={fileInputRef} type="file" multiple onChange={onFilesPicked} className="hidden" />

      <textarea
        ref={textareaRef}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        placeholder={placeholder ?? t("Chat", "LandingPlaceholder")}
        style={{ maxHeight: MAX_HEIGHT }}
        className="block w-full resize-none bg-transparent px-2 py-1.5 text-[14px] leading-[1.6] text-ink placeholder:text-ink-3 focus:outline-none"
      />

      <div className="mt-1 flex items-center gap-1">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title={t("Chat", "Attach")}
          aria-label={t("Chat", "Attach")}
          className="grid size-8 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-frame-hover hover:text-ink"
        >
          <AppIcon name="common/paperclip" size={16} />
        </button>

        <ToolsFlyout />

        {compact ? null : <ModePicker mode={mode} onModeChange={onModeChange} />}

        <div className="ml-auto">
          {isBusy ? (
            <button
              type="button"
              onClick={onStop}
              title={t("Chat", "Stop")}
              aria-label={t("Chat", "Stop")}
              className="grid size-8 place-items-center rounded-full bg-solid text-solid-fg transition-colors hover:bg-solid-hover"
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
              className={cn(
                "grid size-8 place-items-center rounded-full transition-colors",
                canSend ? "bg-solid text-solid-fg hover:bg-solid-hover" : "bg-frame-active text-ink-3",
              )}
            >
              <AppIcon name="common/arrow-up" size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * How long an answer should be. A menu rather than a segmented control: it is set once
 * and then left alone, so it does not deserve three permanent buttons in a row that is
 * already carrying the things you touch every message.
 */
function ModePicker({ mode, onModeChange }: { mode: AssistantMode; onModeChange: (mode: AssistantMode) => void }) {
  const t = useT()
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          title={t("Chat", "AssistantMode")}
          className="flex h-8 items-center gap-1 rounded-lg px-2 text-[12.5px] text-ink-2 transition-colors hover:bg-frame-hover data-[state=open]:bg-frame-active"
        >
          {t("Chat", MODE_LABEL_KEYS[mode])}
          <AppIcon name="chevron-down" size={13} className="text-ink-3" />
        </button>
      </MenuTrigger>
      <MenuContent align="start">
        <MenuRadioGroup value={mode} onValueChange={(v) => onModeChange(v as AssistantMode)}>
          {ASSISTANT_MODES.map((m) => (
            <MenuRadioItem key={m} value={m}>
              {t("Chat", MODE_LABEL_KEYS[m])}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  )
}
