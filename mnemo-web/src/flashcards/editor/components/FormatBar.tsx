import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

const BUTTON_CLASS =
  "grid h-6 min-w-[26px] place-items-center rounded-sm px-1.5 text-[12.5px] text-text-tertiary transition-colors hover:bg-[var(--navigation-button-background-hover)] hover:text-text-primary"

/**
 * The B / I / cloze / image strip above a side's text. It only appears while that side has
 * focus, so a card with nothing selected shows no chrome at all.
 *
 * Mousedown is prevented on every button: clicking one would otherwise blur the textarea, and
 * the transforms need the selection that focus is holding.
 */
export function FormatBar({
  isCloze,
  canAttach,
  onBold,
  onItalic,
  onCloze,
  onInsertImage,
}: {
  isCloze: boolean
  canAttach: boolean
  onBold: () => void
  onItalic: () => void
  onCloze: () => void
  onInsertImage: () => void
}) {
  const t = useT()
  const fc = (key: string) => t("Flashcards", key)

  return (
    <div className="flex items-center gap-0.5" onMouseDown={(event) => event.preventDefault()}>
      <button type="button" title={fc("CardEditorBold")} onClick={onBold} className={cn(BUTTON_CLASS, "font-semibold")}>
        B
      </button>
      <button type="button" title={fc("CardEditorItalic")} onClick={onItalic} className={cn(BUTTON_CLASS, "italic")}>
        I
      </button>
      {isCloze ? (
        <button type="button" title={fc("CardEditorClozeWrap")} onClick={onCloze} className={BUTTON_CLASS}>
          […]
        </button>
      ) : null}

      <span className="mx-1 h-4 w-px bg-divider-subtle" />

      {/* The image button leaves rather than dims once the side is full, matching the desktop. */}
      {canAttach ? (
        <button type="button" title={fc("InsertImage")} onClick={onInsertImage} className={BUTTON_CLASS}>
          <AppIcon name="formatting-toolbar/polaroid" size={14} />
        </button>
      ) : null}
    </div>
  )
}
