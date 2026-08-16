import { useMemo, useState } from "react"

import type { WidgetInstanceDto } from "@/api/types"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { useT } from "@/i18n/useT"

import { WidgetPreview } from "../library/WidgetPreview"
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
 * Per-tile settings, with the tile itself sitting above the controls.
 *
 * The preview is the point. "Days ahead: 8" means nothing until you watch the chart get denser as
 * you drag it, and a settings dialog that makes you press Save and then go and look is a settings
 * dialog you have to open twice.
 *
 * It edits the widget's effective settings, not the persisted row: a decoded copy lives in local
 * state, and only Save encodes it back. Cancel drops the copy and applies nothing. In edit mode the
 * apply is deferred to Done like every other draft change, so the widget refreshes at once but the
 * board is not written until the session commits.
 */
export function WidgetConfigOverlay({ instance, manifest, onApply, onClose }: WidgetConfigOverlayProps) {
  const t = useT()
  // Read off the manifest once. `settings ?? []` is a fresh array every render, which would make
  // the memo below a memo in name only.
  const schemas = useMemo(() => manifest.settings ?? [], [manifest])

  const [fields, setFields] = useState<Record<string, FieldValue>>(() => decodeAll(schemas, instance.settings))

  // What the preview above the fields is rendered with, so it moves as the controls do rather than
  // showing the tile as it was when the dialog opened.
  const draft = useMemo(() => encodeAll(schemas, fields), [schemas, fields])

  const title = t(manifest.ns, manifest.displayNameKey ?? "Title")

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      subtitle={t("WidgetConfig", "Subtitle")}
      closeLabel={t("WidgetConfig", "Cancel")}
      width={420}
      footer={
        <>
          <div />
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("WidgetConfig", "Cancel")}
            </Button>
            <Button
              onClick={() => {
                onApply(draft)
                onClose()
              }}
            >
              {t("WidgetConfig", "Save")}
            </Button>
          </div>
        </>
      }
    >
      <div className="scroll-thin min-w-0 flex-1 overflow-y-auto px-5 pb-5">
        <WidgetPreview manifest={manifest} size={instance.size} settings={draft} boxWidth={380} boxHeight={150} />

        <div className="mt-1 [&>*+*]:border-t [&>*+*]:border-line-soft">
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
      </div>
    </Modal>
  )
}
