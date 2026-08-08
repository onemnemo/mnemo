import { useState } from "react"
import { Dialog } from "radix-ui"

import type { WidgetInstanceDto } from "@/api/types"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"

import type { WidgetManifest } from "../widgets/manifest"
import { ConfigField } from "./ConfigField"
import { decodeAll, encodeAll, type FieldValue } from "./fields"

interface WidgetConfigOverlayProps {
  instance: WidgetInstanceDto
  manifest: WidgetManifest
  /** Writes the encoded bag back onto the instance. The store merges it into the draft. */
  onApply: (values: Record<string, string>) => void
  onClose: () => void
}

/**
 * The per-tile settings dialog: a Radix modal, titled by the widget, with one row per setting.
 *
 * A Radix Dialog on purpose, unlike the library panel. It is genuinely modal, and while it is open
 * isModalOpen() suppresses every window shortcut, which is the behaviour we want here: the board
 * behind it should not answer Escape or anything else until the dialog is done.
 *
 * It edits the widget's effective settings, not the persisted row: a decoded copy lives in local
 * state, and only Save encodes it back. Cancel drops the copy and applies nothing. In edit mode the
 * apply is deferred to Done like every other draft change, so the widget refreshes at once but the
 * board is not written until the session commits.
 */
export function WidgetConfigOverlay({ instance, manifest, onApply, onClose }: WidgetConfigOverlayProps) {
  const t = useT()
  const schemas = manifest.settings ?? []

  const [fields, setFields] = useState<Record<string, FieldValue>>(() => decodeAll(schemas, instance.settings))

  const title = t(manifest.ns, manifest.displayNameKey ?? "Title")

  function save() {
    onApply(encodeAll(schemas, fields))
    onClose()
  }

  return (
    <Dialog.Root open onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex w-[440px] max-w-[calc(100vw-3rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-line bg-card p-5 shadow-elevation-3 focus:outline-none"
        >
          <div className="mb-3 flex flex-col gap-0.5">
            <Dialog.Title className="text-heading-6 font-semibold text-text-primary">{title}</Dialog.Title>
            <p className="text-caption text-text-secondary">{t("WidgetConfig", "Subtitle")}</p>
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {schemas.map((schema) => {
              const value = fields[schema.key]
              if (value === undefined) return null
              return (
                <ConfigField
                  key={schema.key}
                  manifest={manifest}
                  schema={schema}
                  value={value}
                  onChange={(next) => setFields((current) => ({ ...current, [schema.key]: next }))}
                />
              )
            })}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t("WidgetConfig", "Cancel")}
            </Button>
            <Button size="sm" onClick={save}>
              {t("WidgetConfig", "Save")}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
