import { useEffect, useState } from "react"
import { Dialog } from "radix-ui"

import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { IconButton } from "@/components/ui/icon-button"
import { Switch } from "@/components/ui/switch"
import { Segmented } from "@/flashcards/transfer/components/Segmented"
import { useT } from "@/i18n/useT"
import { isMac } from "@/keybinds/chord"
import { toast } from "@/stores/toast"

import { exportNotePdf, fetchNotePdfPreview } from "./api"
import { PdfPreview } from "./components/PdfPreview"
import { PdfSelect } from "./components/PdfSelect"
import { DEFAULT_PDF_OPTIONS, toRequestBody, type PdfOptions } from "./options"
import { useNotePdf, type NotePdfTarget } from "./store"

const SHORTCUT_HINT = isMac ? "⌘⏎" : "Ctrl+⏎"
const PREVIEW_DEBOUNCE_MS = 280

type Tab = "general" | "rendering"
type PreviewState = "loading" | "ready" | "error"

/** Mounted once in the notes workspace; renders only while the store holds a target. */
export function NotePdfExportOverlay() {
  const target = useNotePdf((state) => state.target)
  const close = useNotePdf((state) => state.close)

  if (!target) return null
  return <NotePdfExport target={target} onClose={close} />
}

function NotePdfExport({ target, onClose }: { target: NotePdfTarget; onClose: () => void }) {
  const t = useT()
  const nt = (key: string, params?: Record<string, string | number>) => t("Notes", key, params)
  const common = (key: string) => t("Common", key)

  const [options, setOptions] = useState<PdfOptions>(DEFAULT_PDF_OPTIONS)
  const [tab, setTab] = useState<Tab>("general")
  const [preview, setPreview] = useState<ArrayBuffer | null>(null)
  const [previewState, setPreviewState] = useState<PreviewState>("loading")
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [busy, setBusy] = useState(false)

  const patch = (next: Partial<PdfOptions>) => setOptions((current) => ({ ...current, ...next }))

  // Rebuild the preview on any option change, debounced so a run of quick tweaks compiles once.
  // Each run aborts the previous fetch, which the server turns into a killed compile.
  const optionsKey = JSON.stringify(toRequestBody(options))
  useEffect(() => {
    const controller = new AbortController()
    setPreviewState("loading")
    const timer = setTimeout(() => {
      fetchNotePdfPreview(target.noteId, options, controller.signal)
        .then((bytes) => {
          setPreview(bytes)
          setPage(1)
          setPreviewState("ready")
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          setPreviewState("error")
          if (error instanceof Error) toast.warning(nt("PdfPreviewError"), { description: error.message })
        })
    }, PREVIEW_DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
    // Keyed on the serialized options and the note; nt/toast are stable enough not to drive this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsKey, target.noteId])

  const doExport = async () => {
    if (busy) return
    setBusy(true)
    try {
      await exportNotePdf(target.noteId, options)
      toast.success(nt("PdfExportCompleteTitle"), { description: nt("PdfExportCompleteMessage") })
      onClose()
    } catch (error) {
      toast.warning(nt("PdfExportFailedTitle"), {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setBusy(false)
    }
  }

  const fontHint = (pt: number) => `${String(pt)} pt`
  const clampedPage = Math.min(Math.max(page, 1), Math.max(pageCount, 1))
  const pageLabel = pageCount > 0 ? `${String(clampedPage)} / ${String(pageCount)}` : "– / –"

  return (
    <Dialog.Root open onOpenChange={(next) => !next && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          onKeyDown={(event) => {
            if ((isMac ? event.metaKey : event.ctrlKey) && event.key === "Enter" && !busy) {
              event.preventDefault()
              void doExport()
            }
          }}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[86vh] w-[720px] max-w-[calc(100vw-3rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-line bg-[var(--overlay-background)] shadow-[0_16px_40px_0_rgba(0,0,0,0.22)] focus:outline-none"
        >
          {/* Header */}
          <div className="flex items-start gap-3 border-b border-divider-subtle px-5 py-3.5">
            <AppIcon name="common/download" size={16} className="mt-0.5 shrink-0 text-brand" />
            <div className="min-w-0 flex-1 space-y-0.5">
              <Dialog.Title className="text-body-small font-semibold text-text-primary">
                {nt("PdfExportTitle")}
              </Dialog.Title>
              <div className="truncate text-body-extra-small text-text-tertiary">{target.title}</div>
            </div>
            <Dialog.Close asChild>
              <IconButton icon="common/x" iconSize={14} label={common("Close")} disabled={busy} />
            </Dialog.Close>
          </div>

          {/* Body: controls | preview */}
          <div className="grid min-h-0 flex-1 grid-cols-[300px_1fr]">
            <div className="scroll-thin min-h-0 overflow-y-auto border-r border-divider-subtle px-5 py-[18px]">
              <Segmented<Tab>
                className="mb-4"
                label={`${nt("PdfTabGeneral")} / ${nt("PdfTabRendering")}`}
                value={tab}
                onChange={setTab}
                options={[
                  { value: "general", label: nt("PdfTabGeneral") },
                  { value: "rendering", label: nt("PdfTabRendering") },
                ]}
              />

              {tab === "general" ? (
                <div className="space-y-3.5">
                  <PdfSelect
                    label={nt("PdfPaperSize")}
                    value={options.paper}
                    onChange={(paper) => patch({ paper })}
                    options={[
                      { value: "a4", label: nt("PdfPaperA4") },
                      { value: "letter", label: nt("PdfPaperLetter") },
                    ]}
                  />
                  <PdfSelect
                    label={nt("PdfMargins")}
                    value={options.margin}
                    onChange={(margin) => patch({ margin })}
                    options={[
                      { value: "normal", label: nt("PdfMarginNormal") },
                      { value: "narrow", label: nt("PdfMarginNarrow") },
                    ]}
                  />
                  <PdfSelect
                    label={nt("PdfPageNumberPosition")}
                    value={options.pageNumberPosition}
                    onChange={(pageNumberPosition) => patch({ pageNumberPosition })}
                    options={[
                      { value: "none", label: nt("PdfPageNumberNone") },
                      { value: "left", label: nt("PdfPageNumberLeft") },
                      { value: "center", label: nt("PdfPageNumberCenter") },
                      { value: "right", label: nt("PdfPageNumberRight") },
                    ]}
                  />
                  <PdfSelect
                    label={nt("PdfPageNumberFormat")}
                    value={options.pageNumberFormat}
                    onChange={(pageNumberFormat) => patch({ pageNumberFormat })}
                    disabled={options.pageNumberPosition === "none"}
                    options={[
                      { value: "currentAndTotal", label: nt("PdfPageNumberFormatCurrentTotal") },
                      { value: "current", label: nt("PdfPageNumberFormatCurrent") },
                    ]}
                  />
                </div>
              ) : (
                <div className="space-y-3.5">
                  <PdfSelect
                    label={nt("PdfBaseFontSize")}
                    value={options.fontSize}
                    onChange={(fontSize) => patch({ fontSize })}
                    options={[
                      { value: "small", label: nt("PdfFontSmall"), hint: fontHint(10) },
                      { value: "medium", label: nt("PdfFontMedium"), hint: fontHint(11) },
                      { value: "large", label: nt("PdfFontLarge"), hint: fontHint(12) },
                      { value: "xlarge", label: nt("PdfFontExtraLarge"), hint: fontHint(14) },
                    ]}
                  />

                  <label className="flex cursor-pointer items-center gap-2.5 text-body-extra-small text-text-primary">
                    <Checkbox
                      checked={options.includeTitle}
                      onToggle={() => patch({ includeTitle: !options.includeTitle })}
                      label={nt("PdfIncludeNoteTitle")}
                    />
                    {nt("PdfIncludeNoteTitle")}
                  </label>

                  <div className="space-y-3 border-t border-divider-subtle pt-3.5">
                    <ToggleRow
                      label={nt("PdfRenderHighlights")}
                      checked={options.renderColors}
                      onChange={(renderColors) => patch({ renderColors })}
                    />
                    <ToggleRow
                      label={nt("PdfRenderImages")}
                      checked={options.renderImages}
                      onChange={(renderImages) => patch({ renderImages })}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Preview */}
            <div className="flex min-h-0 flex-col px-5 py-[18px]">
              <div className="mb-2 text-caption font-semibold uppercase tracking-wide text-text-tertiary">
                {nt("PdfPreviewCaption")}
              </div>
              <div className="scroll-thin grid min-h-[300px] flex-1 place-items-center overflow-auto rounded-md bg-[var(--card-background-secondary)] p-6">
                {previewState === "error" ? (
                  <span className="text-body-extra-small text-text-tertiary">{nt("PdfPreviewError")}</span>
                ) : previewState === "loading" && !preview ? (
                  <span className="text-body-extra-small text-text-tertiary">{nt("PdfPreviewLoading")}</span>
                ) : (
                  <div className="relative w-full max-w-[420px]">
                    <PdfPreview
                      data={preview}
                      pageNumber={clampedPage}
                      onLoaded={setPageCount}
                      onError={() => setPreviewState("error")}
                    />
                    {previewState === "loading" ? (
                      <div className="absolute inset-0 grid place-items-center rounded-[3px] bg-black/5">
                        <span className="text-caption text-text-tertiary">{nt("PdfPreviewLoading")}</span>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="mt-2.5 flex items-center gap-2">
                <IconButton
                  icon="common/chevron-left"
                  iconSize={12}
                  label={nt("PdfPreviousPage")}
                  disabled={clampedPage <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                />
                <span className="min-w-[52px] text-center font-mono text-caption text-text-secondary">{pageLabel}</span>
                <IconButton
                  icon="common/chevron-right"
                  iconSize={12}
                  label={nt("PdfNextPage")}
                  disabled={clampedPage >= pageCount}
                  onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center gap-3 border-t border-divider-subtle bg-surface-subtle px-5 py-3.5">
            <span className="min-w-0 flex-1 truncate text-caption text-text-tertiary">{nt("PdfSavesToDownloads")}</span>
            <Button variant="outline" className="h-[34px] px-4" disabled={busy} onClick={onClose}>
              {common("Cancel")}
            </Button>
            <Button className="h-[34px] gap-2 px-[18px]" disabled={busy} onClick={() => void doExport()}>
              {nt("PdfExport")}
              <span className="font-mono text-caption opacity-60">{SHORTCUT_HINT}</span>
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-body-extra-small text-text-primary">{label}</span>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  )
}
