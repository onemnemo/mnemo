import { useEffect, useRef, useState, type ReactNode } from "react"

import {
  announceExport,
  chooseExportTarget,
  exportSaveOptions,
  fetchExportFolders,
  type ChosenTarget,
} from "@/api/export-file"
import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { Segmented } from "@/components/ui/segmented"
import { Switch } from "@/components/ui/switch"
import { useT } from "@/i18n/useT"
import { isMac } from "@/keybinds/chord"
import { cn } from "@/lib/utils"
import { formatFileSize } from "@/notes/transfer/transfer"
import { SelectControl } from "@/settings/components/controls/SelectControl"
import { toast } from "@/stores/toast"

import { fetchNotePdfPreview, saveNotePdf } from "./api"
import { PdfPreview, type PdfPreviewHandle } from "./components/PdfPreview"
import {
  DEFAULT_PDF_OPTIONS,
  FONT_SIZE_PT,
  MARGIN_MM,
  pageNumberSample,
  sanitizeFileStem,
  toRequestBody,
  type FontSizeId,
  type MarginId,
  type PaperId,
  type PdfOptions,
} from "./options"
import type { NotePdfTarget } from "./store"

const SHORTCUT_HINT = isMac ? "⌘ ↵" : "Ctrl ↵"
const PREVIEW_DEBOUNCE_MS = 280

type PreviewState = "loading" | "ready" | "error"

export function NotePdfExport({ target, onClose }: { target: NotePdfTarget; onClose: () => void }) {
  const t = useT()
  const nt = (key: string, params?: Record<string, string | number>) => t("Notes", key, params)
  const common = (key: string) => t("Common", key)

  const [options, setOptions] = useState<PdfOptions>(DEFAULT_PDF_OPTIONS)
  const [stem, setStem] = useState(() => sanitizeFileStem(target.title).trim())
  const [zoom, setZoom] = useState<"fit" | "full">("fit")
  const [preview, setPreview] = useState<ArrayBuffer | null>(null)
  const [previewState, setPreviewState] = useState<PreviewState>("loading")
  const [pageCount, setPageCount] = useState(1)
  const [view, setView] = useState(0)
  const [busy, setBusy] = useState(false)
  const previewHandle = useRef<PdfPreviewHandle | null>(null)

  // The destination Browse settled, held until Save spends it. Null means Save raises the chooser
  // itself, which is also what a browser tab against the dev server always does.
  const [chosen, setChosen] = useState<ChosenTarget | null>(null)
  const [lastFolder, setLastFolder] = useState("")
  const [canChoose, setCanChoose] = useState(false)

  const set = <K extends keyof PdfOptions>(key: K, value: PdfOptions[K]) =>
    setOptions((current) => ({ ...current, [key]: value }))

  // The two strings the server prints into the document, in the language the app is running in.
  const documentText = {
    wordedPageNumber: nt("PdfPageNumberWorded"),
    missingSubpageTitle: nt("PdfSubpageUntitled"),
  }

  const fallbackStem = sanitizeFileStem(target.title).trim() || nt("PdfDefaultFileName")
  const fileName = `${stem.trim() || fallbackStem}.pdf`

  // Rebuild the preview on any option change, debounced so a run of quick tweaks compiles once.
  // Each run aborts the previous fetch, which the server turns into a killed compile.
  const optionsKey = JSON.stringify(toRequestBody(options, documentText))
  useEffect(() => {
    const controller = new AbortController()
    setPreviewState("loading")
    const timer = setTimeout(() => {
      fetchNotePdfPreview(target.noteId, options, documentText, controller.signal)
        .then((bytes) => {
          setPreview(bytes)
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

  // Fewer pages than a moment ago: widened margins, or images turned off.
  useEffect(() => {
    if (view > pageCount - 1) setView(Math.max(0, pageCount - 1))
  }, [pageCount, view])

  useEffect(() => {
    let live = true
    fetchExportFolders()
      .then(({ available, folders }) => {
        if (!live) return
        setCanChoose(available)
        setLastFolder(folders[0] ?? "")
      })
      // A destination nobody can read is one nobody can offer, so the row stays hidden rather than
      // putting an error where a path should be.
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  const ready = stem.trim().length > 0
  // What Save will write to: the folder Browse settled on, or the one the chooser will open on.
  const destination = chosen?.status === "chosen" ? folderOf(chosen.path) : lastFolder

  const doExport = async () => {
    if (busy || !ready) return
    setBusy(true)
    try {
      // The host writes the file, so the toast can name where it actually went instead of
      // asserting that something was saved somewhere.
      const outcome = await saveNotePdf(
        target.noteId,
        options,
        documentText,
        { ...exportSaveOptions(common), fileName },
        chosen,
      )
      // A dismissed chooser leaves the dialog open on the settings that were about to be used.
      if (!announceExport(outcome, { title: nt("PdfExportCompleteTitle"), downloaded: nt("PdfExportCompleteMessage") })) {
        return
      }

      onClose()
    } catch (error) {
      toast.warning(nt("PdfExportFailedTitle"), {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setBusy(false)
    }
  }

  // The same chooser Save raises, only earlier. Holding what it returns is what lets the footer
  // name a destination before anything is written, and what stops Save asking a second time.
  const browse = async () => {
    if (busy) return
    try {
      const picked = await chooseExportTarget({ ...exportSaveOptions(common), fileName })
      if (picked.status !== "chosen") return
      setChosen(picked)
      // The chooser settles the name as well as the folder, so the field follows it. Letting them
      // disagree would put one name in front of the user and another on disk.
      setStem(sanitizeFileStem(stemOf(picked.path)))
    } catch (error) {
      toast.warning(nt("PdfExportFailedTitle"), {
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }

  const goTo = (index: number) => {
    const next = Math.max(0, Math.min(pageCount - 1, index))
    setView(next)
    previewHandle.current?.goTo(next)
  }

  const paperLabel = nt(PAPER_KEYS[options.paper])
  const summary = nt("PdfPreviewSummary", {
    0: pageCount === 1 ? nt("PdfPageCountOne", { 0: 1 }) : nt("PdfPageCountMany", { 0: pageCount }),
    1: paperLabel,
    2: nt(options.landscape ? "PdfOrientationLandscape" : "PdfOrientationPortrait"),
    3: formatFileSize(preview?.byteLength ?? 0),
  })

  return (
    <Modal
      open
      onClose={() => !busy && onClose()}
      width={960}
      // Taller than the app's other dialogs on purpose. The preview shows a whole page, so the
      // height left over after the header and the footer is what decides how big that page is
      // drawn, and at the usual ceiling an A4 sheet lands at roughly a third of its real size.
      maxHeight="min(820px, 92vh)"
      title={nt("PdfExportTitle")}
      subtitle={target.title}
      closeLabel={common("Close")}
      surface={{
        onKeyDown: (event) => {
          if ((isMac ? event.metaKey : event.ctrlKey) && event.key === "Enter") {
            event.preventDefault()
            void doExport()
          }
        },
      }}
      // The dialog this replaces said "Saves to your Downloads" in grey down here, which is not a
      // destination: it is the app telling you where it has already decided to put the thing. The
      // name goes on the line with the button that uses it, where it also stops crowding a rail
      // that is about page setup.
      footer={
        <>
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <label className="flex h-9 w-[224px] shrink-0 items-center gap-1.5 rounded-lg px-2.5 shadow-[0_0_0_1px_var(--line)] focus-within:shadow-[0_0_0_1.5px_var(--accent)]">
              <AppIcon name="common/file-text" size={14} className="shrink-0 text-ink-icon" />
              <input
                value={stem}
                onChange={(event) => {
                  setStem(sanitizeFileStem(event.target.value))
                  // The held destination carries the name the chooser confirmed. Once that is not
                  // the name in the field, Save has to ask again rather than write the old one.
                  setChosen(null)
                }}
                aria-label={nt("PdfFileName")}
                spellCheck={false}
                placeholder={fallbackStem}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
              />
              {/* Shown, never typed, or the first file anyone makes is `Note.pdf.pdf`. */}
              <span className="shrink-0 font-mono text-[12px] text-ink-3">.pdf</span>
            </label>

            {canChoose && (
              <>
                <div
                  className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 shadow-[0_0_0_1px_var(--line)]"
                  title={destination}
                >
                  <AppIcon name="common/folder" size={14} className="shrink-0 text-ink-icon" />
                  <span
                    className="min-w-0 flex-1 truncate text-[13px] text-ink"
                    aria-label={nt("PdfDestinationFolder")}
                  >
                    {destination}
                  </span>
                </div>
                <Button variant="outline" className="h-9 shrink-0" disabled={busy} onClick={() => void browse()}>
                  {nt("PdfBrowse")}
                </Button>
              </>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              {common("Cancel")}
            </Button>
            <Button
              variant="solid"
              disabled={busy || !ready}
              onClick={() => void doExport()}
              trailing={<span className="ml-1 text-[11.5px] font-normal opacity-55">{SHORTCUT_HINT}</span>}
            >
              {common("Save")}
            </Button>
          </div>
        </>
      }
    >
      {/* Everything on one column, nothing behind a tab. The dialog this replaces split its
          controls across "General" and "Rendering", which meant half the settings were invisible
          while you looked at the preview they change. The rail is page setup and nothing else. */}
      <div className="scroll-thin w-[336px] shrink-0 overflow-y-auto border-r border-line-soft px-5 pb-5 pt-0.5">
        <Group label={nt("PdfGroupPage")}>
          <Row label={nt("PdfPaperSize")}>
            <SelectControl
              label={nt("PdfPaperSize")}
              value={options.paper}
              onChange={(value) => set("paper", value as PaperId)}
              choices={PAPERS.map((paper) => ({ value: paper, label: nt(PAPER_KEYS[paper]) }))}
              className="min-w-[112px]"
            />
          </Row>
          {/* Named rather than drawn. Two bare rectangles are the convention, but they are also two
              buttons with no accessible name directly above a control that spells its options out. */}
          <Row label={nt("PdfOrientation")}>
            <Segmented
              className="w-[176px]"
              label={nt("PdfOrientation")}
              value={options.landscape ? "wide" : "tall"}
              onChange={(value) => set("landscape", value === "wide")}
              options={[
                { value: "tall", label: nt("PdfOrientationPortrait") },
                { value: "wide", label: nt("PdfOrientationLandscape") },
              ]}
            />
          </Row>
          {/* A scale, so all three stay on screen. A dropdown reading "Normal" hides the fact that
              it is the middle of one. */}
          <Row label={nt("PdfMargins")} hint={nt("PdfMillimetres", { 0: MARGIN_MM[options.margin] })}>
            <Segmented
              className="w-[168px]"
              label={nt("PdfMargins")}
              value={options.margin}
              onChange={(value) => set("margin", value as MarginId)}
              options={MARGINS.map((margin) => ({ value: margin, label: nt(MARGIN_KEYS[margin]) }))}
            />
          </Row>
          <Row label={nt("PdfBaseFontSize")}>
            <SelectControl
              label={nt("PdfBaseFontSize")}
              value={options.fontSize}
              onChange={(value) => set("fontSize", value as FontSizeId)}
              choices={FONT_SIZES.map((size) => ({
                value: size,
                label: `${nt(FONT_SIZE_KEYS[size])} · ${nt("PdfPoints", { 0: FONT_SIZE_PT[size] })}`,
              }))}
              className="min-w-[132px]"
            />
          </Row>
        </Group>

        {/* Position and "off" are the same decision, so they are one control. The old pair, a
            position dropdown and a separate style dropdown both always present, asked you to
            choose a numbering format for a document that might not be numbered. */}
        <Group label={nt("PdfPageNumberPosition")} className="mt-6">
          <div className="py-2">
            <Segmented
              label={nt("PdfPageNumberPosition")}
              value={options.pageNumbers}
              onChange={(value) => set("pageNumbers", value)}
              options={[
                { value: "none", label: nt("PdfPageNumberNone") },
                { value: "left", label: nt("PdfPageNumberLeft") },
                { value: "center", label: nt("PdfPageNumberCenter") },
                { value: "right", label: nt("PdfPageNumberRight") },
              ]}
            />
          </div>
          {options.pageNumbers !== "none" && (
            <Row label={nt("PdfPageNumberStyle")}>
              <SelectControl
                label={nt("PdfPageNumberFormat")}
                value={options.pageNumberStyle}
                onChange={(value) => set("pageNumberStyle", value as PdfOptions["pageNumberStyle"])}
                // Written out with the real numbers of the page being looked at, so the option is
                // a sample rather than a name.
                choices={PAGE_NUMBER_STYLES.map((style) => ({
                  value: style,
                  label: pageNumberSample(style, view + 1, pageCount, documentText.wordedPageNumber),
                }))}
                className="min-w-[132px]"
              />
            </Row>
          )}
        </Group>

        {/* Bare labels: a hint on these rows would describe what the preview is already showing.
            The one below is kept because paper genuinely cannot do the thing that switch is named
            after, and no preview says so. */}
        <Group label={nt("PdfGroupInclude")} className="mt-6">
          <Toggle label={nt("PdfIncludeTitle")} on={options.includeTitle} onChange={(v) => set("includeTitle", v)} />
          <Toggle label={nt("PdfIncludeTags")} on={options.includeTags} onChange={(v) => set("includeTags", v)} />
          <Toggle
            label={nt("PdfRenderHighlights")}
            on={options.renderColors}
            onChange={(v) => set("renderColors", v)}
          />
          <Toggle label={nt("PdfRenderImages")} on={options.renderImages} onChange={(v) => set("renderImages", v)} />
          <Toggle
            label={nt("PdfIncludeSubpages")}
            hint={nt("PdfIncludeSubpagesHint")}
            on={options.renderSubpages}
            onChange={(v) => set("renderSubpages", v)}
          />
        </Group>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas-sunken">
        {/* The bar says what the settings did rather than labelling a pane that obviously shows a
            preview: the count is the whole reason the preview is measured. */}
        <div className="flex h-11 shrink-0 items-center gap-2 px-4">
          <span className="min-w-0 truncate text-[12px] text-ink-3">
            {previewState === "error" ? nt("PdfPreviewError") : preview ? summary : nt("PdfPreviewLoading")}
          </span>
          <div className="flex-1" />

          {/* Only when there is more than one page. A "1 / 1" beside two dead arrows is a control
              that exists to say it has nothing to do. */}
          {pageCount > 1 && (
            <div className="flex items-center gap-0.5">
              <Step label={nt("PdfPreviousPage")} disabled={view === 0} onClick={() => goTo(view - 1)}>
                <AppIcon name="common/chevron-left" size={16} strokeWidth={1.8} />
              </Step>
              <span className="min-w-[52px] text-center text-[12px] tabular-nums text-ink-2">
                {view + 1} / {pageCount}
              </span>
              <Step
                label={nt("PdfNextPage")}
                disabled={view === pageCount - 1}
                onClick={() => goTo(view + 1)}
              >
                <AppIcon name="common/chevron-right" size={16} strokeWidth={1.8} />
              </Step>
            </div>
          )}

          <Segmented
            className="w-[112px]"
            label={nt("PdfZoom")}
            value={zoom}
            onChange={setZoom}
            options={[
              { value: "fit", label: nt("PdfZoomFit") },
              { value: "full", label: nt("PdfZoomFull") },
            ]}
          />
        </div>

        <div className="relative flex min-h-0 flex-1 flex-col">
          <PdfPreview
            data={preview}
            zoom={zoom}
            handleRef={previewHandle}
            onLoaded={setPageCount}
            onView={setView}
            onError={() => setPreviewState("error")}
          />
          {previewState !== "ready" && (
            <div
              className={cn(
                "absolute inset-0 grid place-items-center text-[12.5px] text-ink-3",
                // Only a veil once there is something to veil; before the first render the pane is
                // empty anyway and a wash over nothing just greys the message.
                preview && "bg-canvas-sunken/70",
              )}
            >
              {previewState === "error" ? nt("PdfPreviewError") : nt("PdfPreviewLoading")}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

const PAPERS = ["a4", "letter", "legal", "a5"] as const
const PAPER_KEYS: Record<PaperId, string> = {
  a4: "PdfPaperA4",
  letter: "PdfPaperLetter",
  legal: "PdfPaperLegal",
  a5: "PdfPaperA5",
}

const MARGINS = ["narrow", "normal", "wide"] as const
const MARGIN_KEYS: Record<MarginId, string> = {
  narrow: "PdfMarginNarrow",
  normal: "PdfMarginNormal",
  wide: "PdfMarginWide",
}

const FONT_SIZES = ["small", "medium", "large", "xlarge"] as const
const FONT_SIZE_KEYS: Record<FontSizeId, string> = {
  small: "PdfFontSmall",
  medium: "PdfFontMedium",
  large: "PdfFontLarge",
  xlarge: "PdfFontExtraLarge",
}

const PAGE_NUMBER_STYLES = ["current", "currentAndTotal", "worded"] as const

/**
 * A titled run of rows.
 *
 * Sentence case rather than letterspaced uppercase: a caps micro-label shouts its word louder than
 * the dialog title above it, and three of them stacked down a 336px rail is most of what makes a
 * settings column look like a pile.
 */
function Group({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <section className={className}>
      <h3 className="text-[12.5px] font-medium text-ink-3">{label}</h3>
      {/* Hairlines between rows, not around the group. The rows are what run together; a box
          around all of them separates the wrong thing. */}
      <div className="mt-0.5 [&>*+*]:border-t [&>*+*]:border-line-soft">{children}</div>
    </section>
  )
}

/** Label on the left, the control on the right, as everywhere else in Settings. */
function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-[13.5px] text-ink">{label}</p>
        {hint && <p className="mt-0.5 text-[12px] leading-snug text-ink-3">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Toggle({
  label,
  hint,
  on,
  onChange,
}: {
  label: string
  hint?: string
  on: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <Row label={label} hint={hint}>
      <Switch checked={on} onChange={onChange} label={label} />
    </Row>
  )
}

function Step({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-frame-hover hover:text-ink disabled:pointer-events-none disabled:opacity-35"
      style={{ transitionDuration: "var(--duration-fast)" }}
    >
      {children}
    </button>
  )
}

/** Where the separator falls in a path the chooser returned, on either platform's. */
function lastSeparator(path: string): number {
  return Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"))
}

/** The folder the file is going into, for the row that names it. */
function folderOf(path: string): string {
  const cut = lastSeparator(path)
  return cut < 0 ? "" : path.slice(0, cut)
}

/** The name, without the extension the field spells out beside it. */
function stemOf(path: string): string {
  return path.slice(lastSeparator(path) + 1).replace(/\.pdf$/i, "")
}
