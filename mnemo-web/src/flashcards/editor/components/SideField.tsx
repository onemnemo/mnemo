import { useEffect, useRef, useState } from "react"

import type { CardSide } from "@/api/types"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import type { DraftAttachment } from "../draft"
import { IMAGE_ACCEPT, MAX_ATTACHMENTS_PER_SIDE, wrapCloze, wrapWithMarker, type TextEdit } from "../editor-state"
import { AttachmentFigure } from "./AttachmentFigure"
import { FormatBar } from "./FormatBar"

/** One side of the card: its label, format bar, text and attached images. */
export function SideField({
  side,
  label,
  value,
  isCloze,
  focused,
  focusSignal,
  attachments,
  onChange,
  onFocus,
  onAttachFiles,
  onReplaceAttachment,
  onRemoveAttachment,
}: {
  side: CardSide
  label: string
  value: string
  isCloze: boolean
  focused: boolean
  /** Focus this field whenever the value changes; ignored when not supplied. */
  focusSignal?: number
  attachments: DraftAttachment[]
  onChange: (next: string) => void
  onFocus: () => void
  onAttachFiles: (side: CardSide, files: File[]) => void
  onReplaceAttachment: (key: string, file: File) => void
  onRemoveAttachment: (key: string) => void
}) {
  const t = useT()
  const textarea = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  // Set while the picker was opened by a figure's Replace link rather than the toolbar.
  const replacing = useRef<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const canAttach = attachments.length < MAX_ATTACHMENTS_PER_SIDE

  useEffect(() => {
    if (focusSignal) textarea.current?.focus()
  }, [focusSignal])

  const applyEdit = (transform: (text: string, start: number, end: number) => TextEdit) => {
    const element = textarea.current
    if (!element) return
    const start = Math.min(element.selectionStart, element.selectionEnd)
    const end = Math.max(element.selectionStart, element.selectionEnd)
    const edit = transform(value, start, end)
    onChange(edit.text)
    // The caret has to be placed after React has written the new value, or it lands in the
    // old text and the browser moves it to the end.
    requestAnimationFrame(() => {
      element.focus()
      const caret = Math.max(0, Math.min(edit.caret, edit.text.length))
      element.setSelectionRange(caret, caret)
    })
  }

  const attach = (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith("image/"))
    if (images.length > 0) onAttachFiles(side, images)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] font-semibold tracking-[1px] text-text-faded">{label}</span>
        {focused ? (
          <FormatBar
            isCloze={isCloze}
            canAttach={canAttach}
            onBold={() => applyEdit((text, start, end) => wrapWithMarker(text, start, end, "**"))}
            onItalic={() => applyEdit((text, start, end) => wrapWithMarker(text, start, end, "*"))}
            onCloze={() => applyEdit(wrapCloze)}
            onInsertImage={() => {
              replacing.current = null
              picker.current?.click()
            }}
          />
        ) : null}
      </div>

      <div
        onDragOver={(event) => {
          if (!canAttach) return
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          attach(Array.from(event.dataTransfer.files))
        }}
        className={cn(
          "rounded-md border bg-[var(--workspace-background)] px-3 py-2.5 transition-[border-color,box-shadow] duration-150 ease-out",
          focused || dragging
            ? "border-brand shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_15%,transparent)]"
            : "border-line",
        )}
      >
        <textarea
          ref={textarea}
          // The visible label is a bare caption above the box, not a <label> for it.
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={onFocus}
          onKeyDown={(event) => {
            // Ctrl/Cmd+Shift+C wraps the selection as the next cloze, the desktop's shortcut.
            if (isCloze && event.shiftKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
              event.preventDefault()
              applyEdit(wrapCloze)
            }
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files)
            // Only swallow the paste when it actually carried an image; a mixed clipboard
            // should still drop its text into the box.
            if (files.some((file) => file.type.startsWith("image/"))) event.preventDefault()
            attach(files)
          }}
          className="min-h-[56px] w-full resize-none bg-transparent text-body-small text-text-primary outline-none"
        />

        {attachments.length > 0 ? (
          <div className="mt-2.5 flex flex-col gap-2">
            {attachments.map((attachment) => (
              <AttachmentFigure
                key={attachment.key}
                attachment={attachment}
                onReplace={() => {
                  replacing.current = attachment.key
                  picker.current?.click()
                }}
                onRemove={() => onRemoveAttachment(attachment.key)}
              />
            ))}
          </div>
        ) : null}
      </div>

      <input
        ref={picker}
        type="file"
        accept={IMAGE_ACCEPT}
        className="hidden"
        onChange={(event) => {
          const [file] = Array.from(event.target.files ?? [])
          const key = replacing.current
          replacing.current = null
          if (key && file) onReplaceAttachment(key, file)
          else if (file) attach([file])
          // Reset so picking the same file twice in a row still fires a change event.
          event.target.value = ""
        }}
        aria-label={t("Flashcards", "InsertImage")}
      />
    </div>
  )
}
