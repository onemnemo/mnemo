import { useEffect, useRef, useState } from "react"

import type { CardTypeFieldDto } from "@/api/types"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { AttachmentStrip } from "../../editor/components/AttachmentStrip"
import { FormatBar } from "../../editor/components/FormatBar"
import type { DraftAttachment } from "../../editor/draft"
import {
  IMAGE_ACCEPT,
  MAX_ATTACHMENTS_PER_SIDE,
  wrapAround,
  wrapCloze,
  wrapWithMarker,
  type TextEdit,
} from "../../editor/editor-state"

/**
 * One field of a card type: its name, a format bar that floats on focus, the text, and whatever is
 * attached to it.
 *
 * Attachments hang off the field rather than off a card side, so the strip below is per field and
 * per kind. A picture strip is what exists today; a strip for another kind of attachment sits
 * beside it rather than replacing it.
 */
export function FieldEditor({
  field,
  value,
  isCloze,
  focused,
  focusSignal,
  rows,
  attachments,
  onChange,
  onFocus,
  onAttachFiles,
  onRemoveAttachment,
}: {
  field: CardTypeFieldDto
  value: string
  /** Whether this field carries the deletions, which is what puts the cloze button on the bar. */
  isCloze: boolean
  focused: boolean
  /** Focus this field whenever the value changes; ignored when not supplied. */
  focusSignal?: number
  rows: number
  attachments: DraftAttachment[]
  onChange: (next: string) => void
  onFocus: () => void
  onAttachFiles: (fieldId: string, files: File[]) => void
  onRemoveAttachment: (fieldId: string, key: string) => void
}) {
  const t = useT()
  const textarea = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
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
    // The caret has to be placed after React has written the new value, or it lands in the old
    // text and the browser moves it to the end.
    requestAnimationFrame(() => {
      element.focus()
      const caret = Math.max(0, Math.min(edit.caret, edit.text.length))
      element.setSelectionRange(caret, caret)
    })
  }

  const mark = (marker: string) => () => applyEdit((text, start, end) => wrapWithMarker(text, start, end, marker))

  const attach = (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith("image/"))
    if (images.length > 0) onAttachFiles(field.id, images)
  }

  return (
    <div className="relative flex flex-col gap-1.5">
      <label className="flex items-baseline gap-2 text-[12px] font-medium text-ink-3">
        <span className="uppercase tracking-[0.04em]">{field.name}</span>
        {field.hint ? <span className="text-[11px] font-normal normal-case text-ink-3/80">{field.hint}</span> : null}
      </label>

      {/* Floats on the field's top edge rather than pushing it down, so moving between fields does
          not make the whole dialog jump each time a toolbar appears. */}
      {focused ? (
        <FormatBar
          className="animate-pop-in absolute -top-1 right-0 z-10 rounded-lg bg-canvas p-0.5 shadow-pop"
          isCloze={isCloze}
          canAttach={canAttach}
          onBold={mark("**")}
          onItalic={mark("*")}
          onUnderline={mark("__")}
          onCode={mark("`")}
          onHighlight={mark("==")}
          onFormula={mark("$")}
          onBullet={() => applyEdit((text, start, end) => wrapAround(text, start, end, "\n- ", ""))}
          onCloze={() => applyEdit(wrapCloze)}
          onInsertImage={() => picker.current?.click()}
        />
      ) : null}

      <textarea
        ref={textarea}
        // The visible caption is a bare label above the box, not a <label> for it.
        aria-label={field.name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        onKeyDown={(event) => {
          if (isCloze && event.shiftKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
            event.preventDefault()
            applyEdit(wrapCloze)
          }
        }}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files)
          // Only swallow the paste when it actually carried an image; a mixed clipboard should
          // still drop its text into the box.
          if (files.some((file) => file.type.startsWith("image/"))) event.preventDefault()
          attach(files)
        }}
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
        rows={rows}
        className={cn(
          "w-full resize-none rounded-lg bg-transparent px-3 py-2.5 text-[13.5px] leading-[1.55] text-ink outline-none transition-shadow",
          // The drop target is the field you are about to drop into, so the field itself says so;
          // a dashed overlay across the whole dialog would leave you guessing which one gets it.
          dragging
            ? "bg-accent-wash shadow-[0_0_0_1.5px_var(--accent)]"
            : "shadow-[0_0_0_1px_var(--line)] focus:shadow-[0_0_0_1.5px_var(--solid)]",
        )}
      />

      <AttachmentStrip
        attachments={attachments}
        canAttach={canAttach}
        onAdd={() => picker.current?.click()}
        onRemove={(key) => onRemoveAttachment(field.id, key)}
      />

      <input
        ref={picker}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        className="hidden"
        onChange={(event) => {
          attach(Array.from(event.target.files ?? []))
          // Reset so picking the same file twice in a row still fires a change event.
          event.target.value = ""
        }}
        aria-label={t("Flashcards", "InsertImage")}
      />
    </div>
  )
}
