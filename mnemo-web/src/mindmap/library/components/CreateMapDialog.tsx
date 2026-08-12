import { Dialog } from "radix-ui"
import { useEffect, useRef, useState } from "react"

import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { useMindmapTemplates } from "../../api"
import type { StyleTemplate } from "../../model/document"
import { cssColor } from "../../scene/tokens"

export interface CreateMapDialogProps {
  open: boolean
  /** True while the map is being made, which is the only time this dialog waits on anything. */
  busy: boolean
  onCancel: () => void
  onCreate: (title: string, templateId: string | null) => void
}

/**
 * The name and the starting look of a map that does not exist yet.
 *
 * A template is picked here rather than after the fact because it decides what the first node looks
 * like, and changing it later restyles a map somebody has already made decisions about. Offering it
 * at the one moment nothing can be undone is the cheapest place to ask.
 *
 * The gallery is allowed to be missing. Templates are a styling detail the server can fall back on
 * by itself, so a failed or slow fetch leaves the name field working rather than holding the dialog
 * shut behind a request.
 */
export function CreateMapDialog({ open, busy, onCancel, onCreate }: CreateMapDialogProps) {
  const t = useT()
  const mm = (key: string) => t("Mindmap", key)

  const catalogue = useMindmapTemplates()
  const templates = catalogue.data?.templates ?? []

  const [name, setName] = useState("")
  const [templateId, setTemplateId] = useState<string | null>(null)
  const field = useRef<HTMLInputElement>(null)

  // Every opening starts over. A name typed and then abandoned is not a suggestion for next time.
  useEffect(() => {
    if (open) {
      setName(mm("NewMindmap"))
      setTemplateId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const chosen = templateId ?? catalogue.data?.defaultId ?? null
  const trimmed = name.trim()
  const canCreate = trimmed.length > 0 && !busy

  function commit() {
    if (canCreate) {
      onCreate(trimmed, chosen)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-[var(--overlay-background)] p-5 shadow-elevation-4 focus:outline-none"
          // Taking focus by hand rather than letting the dialog place it, so the default name arrives
          // selected: gone on the first keystroke, still there for anyone who just presses Create.
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            field.current?.focus()
            field.current?.select()
          }}
        >
          <Dialog.Title className="text-heading-6 font-semibold text-foreground">
            {mm("CreateMapTitle")}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-body-small text-muted-foreground">
            {mm("CreateMapDescription")}
          </Dialog.Description>

          <input
            ref={field}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={mm("CreateMapNamePlaceholder")}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit()
            }}
            className="mt-3 w-full rounded-md border bg-[var(--text-control-background)] px-3 py-2 text-body-small text-foreground placeholder:text-[var(--text-control-placeholder-foreground)] focus:border-[var(--text-control-border-focused)] focus:outline-none"
          />

          {templates.length > 0 && (
            <div className="mt-4">
              <span className="text-body-small font-medium text-foreground">{mm("StartingTemplate")}</span>
              <div className="mt-2 grid max-h-[248px] grid-cols-3 gap-2 overflow-y-auto">
                {templates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    aria-pressed={template.id === chosen}
                    onClick={() => setTemplateId(template.id)}
                    className={cn(
                      "flex flex-col items-center gap-2.5 rounded-lg border-[1.5px] bg-secondary/60 p-2.5 transition-colors",
                      template.id === chosen ? "border-primary" : "border-transparent hover:border-border",
                    )}
                  >
                    <span className="flex gap-[5px]">
                      {previewTokens(template).map((token, slot) => (
                        <span
                          key={slot}
                          className="size-3.5 rounded-full border border-[var(--divider-subtle)]"
                          style={{ background: cssColor(token) }}
                        />
                      ))}
                    </span>
                    <span className="w-full truncate text-center text-caption text-foreground">
                      {template.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md bg-secondary px-3 py-1.5 text-body-small font-medium text-secondary-foreground transition-colors hover:brightness-95"
            >
              {mm("Cancel")}
            </button>
            <button
              type="button"
              disabled={!canCreate}
              onClick={commit}
              className="rounded-md bg-primary px-3 py-1.5 text-body-small font-medium text-primary-foreground transition-colors hover:brightness-95 disabled:pointer-events-none disabled:opacity-40"
            >
              {mm("Create")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/**
 * Four colours that tell one template from another at a glance: its root fill, then either the
 * branch ramp it colours with or the neutrals it settles for. Not a rendering of the template, which
 * would need a map to render.
 */
function previewTokens(template: StyleTemplate): string[] {
  const root = template.rootStyle?.fill ?? "accent"
  if (template.branchColors === "byBranch") {
    return [root, "palette.2", "palette.3", "palette.4"]
  }
  return [root, template.depthRules?.[0]?.style.fill ?? "surfaceAlt", "textMuted", "stroke"]
}
