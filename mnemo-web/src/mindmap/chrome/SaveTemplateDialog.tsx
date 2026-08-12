import { Dialog } from "radix-ui"
import { useEffect, useState } from "react"

import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"
import { toast } from "@/stores/toast"

import { useMindmapCaptureInfo, useSaveMindmapTemplate } from "../api"

export interface SaveTemplateDialogProps {
  mapId: string
  /** The node the capture starts at, or null when the dialog is shut. */
  rootId: string | null
  onClose: () => void
}

/**
 * Turns a styled branch into a template other maps can wear.
 *
 * How deep it can go is asked of the server rather than counted here, for the same reason the
 * capture itself happens there: the walk that decides which style stands for a depth band has a
 * tie-break in it, and a picker counting levels its own way would offer one the capture then skips.
 *
 * The count arrives after the dialog is already up, so the level row is the last thing to settle.
 * That is the right way round: the name is what the user came to type, and making them wait on a
 * request before they can start typing it would be a spinner in front of a text field.
 */
export function SaveTemplateDialog({ mapId, rootId, onClose }: SaveTemplateDialogProps) {
  const t = useT()
  const mm = (key: string) => t("Mindmap", key)

  const info = useMindmapCaptureInfo(mapId, rootId)
  const save = useSaveMindmapTemplate()

  const [name, setName] = useState("")
  const [levels, setLevels] = useState(1)

  // A fresh node is a fresh capture: whatever was typed for the last one is not a starting point.
  useEffect(() => {
    setName("")
  }, [rootId])

  // Everything by default, since a branch styled three deep was styled three deep on purpose.
  const available = info.data?.availableLevels ?? 0
  useEffect(() => {
    setLevels(Math.max(1, available))
  }, [available])

  const trimmed = name.trim()
  const nothingStyled = info.isSuccess && available <= 0
  const canSave = trimmed.length > 0 && available > 0 && !save.isPending

  async function commit() {
    if (!rootId || !canSave) {
      return
    }
    try {
      await save.mutateAsync({ mapId, rootId, name: trimmed, levels })
      toast.success(mm("TemplateSaved"), { description: trimmed })
      onClose()
    } catch (error) {
      toast.warning(mm("ErrorTitle"), {
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }

  return (
    <Dialog.Root open={rootId != null} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-[var(--overlay-background)] p-5 shadow-elevation-4 focus:outline-none">
          <Dialog.Title className="text-heading-6 font-semibold text-foreground">
            {mm("SaveTemplateTitle")}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-body-small text-muted-foreground">
            {nothingStyled ? mm("NothingToCapture") : mm("SaveTemplateDescription")}
          </Dialog.Description>

          {!nothingStyled && (
            <>
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={mm("TemplateNamePlaceholder")}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void commit()
                }}
                className="mt-3 w-full rounded-md border bg-[var(--text-control-background)] px-3 py-2 text-body-small text-foreground placeholder:text-[var(--text-control-placeholder-foreground)] focus:border-[var(--text-control-border-focused)] focus:outline-none"
              />

              {available > 0 && (
                <div className="mt-4">
                  <div className="flex items-baseline justify-between">
                    <span className="text-body-small font-medium text-foreground">{mm("LevelsToCapture")}</span>
                    <span className="text-caption text-muted-foreground">
                      {(levels === 1 ? mm("LevelsCountOne") : mm("LevelsCountMany")).replace("{0}", String(levels))}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {Array.from({ length: available }, (_, index) => index + 1).map((level) => (
                      <button
                        key={level}
                        type="button"
                        aria-pressed={level === levels}
                        onClick={() => setLevels(level)}
                        className={cn(
                          "h-8 min-w-[42px] rounded-md border px-2 text-body-small tabular-nums transition-colors",
                          level === levels
                            ? "border-transparent bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                        )}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-secondary px-3 py-1.5 text-body-small font-medium text-secondary-foreground transition-colors hover:brightness-95"
            >
              {nothingStyled ? t("Common", "Close") : mm("Cancel")}
            </button>
            {!nothingStyled && (
              <button
                type="button"
                disabled={!canSave}
                onClick={() => void commit()}
                className="rounded-md bg-primary px-3 py-1.5 text-body-small font-medium text-primary-foreground transition-colors hover:brightness-95 disabled:pointer-events-none disabled:opacity-40"
              >
                {mm("Save")}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
