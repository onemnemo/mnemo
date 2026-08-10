import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

const BUTTON_CLASS =
  "grid size-6 place-items-center rounded-md text-ink-2 transition-colors hover:bg-frame-hover hover:text-ink disabled:pointer-events-none disabled:opacity-35"

/**
 * The formatting strip that floats over a side's top edge while it has focus, so a card with
 * nothing selected shows no chrome at all.
 *
 * Mousedown is prevented on the whole bar: clicking a button would otherwise blur the textarea,
 * and every transform needs the selection that focus is holding.
 */
export function FormatBar({
  isCloze,
  canAttach,
  className,
  onBold,
  onItalic,
  onUnderline,
  onCode,
  onHighlight,
  onFormula,
  onBullet,
  onCloze,
  onInsertImage,
}: {
  isCloze: boolean
  canAttach: boolean
  className?: string
  onBold: () => void
  onItalic: () => void
  onUnderline: () => void
  onCode: () => void
  onHighlight: () => void
  onFormula: () => void
  onBullet: () => void
  onCloze: () => void
  onInsertImage: () => void
}) {
  const t = useT()
  const fc = (key: string) => t("Flashcards", key)

  const marks = [
    { icon: "bold", label: fc("CardEditorBold"), onClick: onBold },
    { icon: "italic", label: fc("CardEditorItalic"), onClick: onItalic },
    { icon: "underline", label: fc("CardEditorUnderline"), onClick: onUnderline },
    { icon: "code", label: fc("CardEditorCode"), onClick: onCode },
    { icon: "highlighter", label: fc("CardEditorHighlight"), onClick: onHighlight },
    { icon: "sigma", label: fc("CardEditorFormula"), onClick: onFormula },
    { icon: "list", label: fc("CardEditorBullet"), onClick: onBullet },
  ]

  return (
    <div className={cn("flex items-center gap-0.5", className)} onMouseDown={(event) => event.preventDefault()}>
      {marks.map((mark) => (
        <button key={mark.icon} type="button" title={mark.label} aria-label={mark.label} onClick={mark.onClick} className={BUTTON_CLASS}>
          <AppIcon name={mark.icon} size={14} strokeWidth={1.9} />
        </button>
      ))}

      {/* Attaching a figure is a thing you do to this side while writing it, so it sits with the
          formatting rather than off in a property panel. It leaves once the side is full. */}
      <span className="mx-0.5 h-4 w-px bg-line-soft" />
      <button
        type="button"
        title={fc("InsertImage")}
        aria-label={fc("InsertImage")}
        disabled={!canAttach}
        onClick={onInsertImage}
        className={BUTTON_CLASS}
      >
        <AppIcon name="formatting-toolbar/polaroid" size={14} />
      </button>

      {isCloze ? (
        <>
          <span className="mx-0.5 h-4 w-px bg-line-soft" />
          <button
            type="button"
            title={fc("CardEditorClozeWrap")}
            aria-label={fc("CardEditorClozeWrap")}
            onClick={onCloze}
            className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11.5px] font-medium text-ink-2 transition-colors hover:bg-frame-hover hover:text-ink"
          >
            <AppIcon name="braces" size={12} strokeWidth={2} />
            {fc("TypeCloze")}
          </button>
        </>
      ) : null}
    </div>
  )
}
