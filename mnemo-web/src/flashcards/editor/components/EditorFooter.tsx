import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"
import { isMac } from "@/keybinds/chord"

/** The save shortcut, spelled the way the host platform does. */
const SHORTCUT_HINT = isMac ? "⌘⏎" : "Ctrl+⏎"

/**
 * The editor's footer. In add mode the primary button saves and clears for the next card, so
 * the running count sits opposite it as the only sign anything happened.
 */
export function EditorFooter({
  isEditMode,
  sessionAdded,
  canSave,
  saving,
  onClose,
  onSave,
}: {
  isEditMode: boolean
  sessionAdded: number
  canSave: boolean
  saving: boolean
  onClose: () => void
  onSave: () => void
}) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)

  return (
    <div className="flex items-center justify-between border-t border-line-soft px-5 py-3">
      {!isEditMode ? (
        <span className="text-[12px] text-ink-3">{fc("CardEditorSessionAddedFormat", { 0: sessionAdded })}</span>
      ) : (
        <span />
      )}

      <div className="flex items-center gap-2">
        <Button variant="ghost" className="h-[34px] px-4" onClick={onClose}>
          {fc("CloseCard")}
        </Button>
        <Button className="h-[34px] gap-2 px-4" disabled={!canSave || saving} onClick={onSave}>
          {fc(isEditMode ? "Save" : "AddCard")}
          {!isEditMode ? (
            <span className="rounded-[5px] bg-solid-fg/15 px-1 text-[11px] font-medium">{SHORTCUT_HINT}</span>
          ) : null}
        </Button>
      </div>
    </div>
  )
}
