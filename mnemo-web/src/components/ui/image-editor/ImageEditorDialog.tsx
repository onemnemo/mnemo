import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ClipboardEvent } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { Segmented } from "@/components/ui/segmented"
import { useT } from "@/i18n/useT"

import { CropStage } from "./CropStage"
import { FIT, ZOOM_MAX, fromCrop, toCrop, zoomAt, type Frame, type View } from "./geometry"
import { ACCEPTED_IMAGE_TYPES, firstImageFile, imageFileProblem } from "./source"
import { ownSourceUrl, type ImageEditRequest, type ImageEditResult } from "./store"

/**
 * One dialog for every image the app takes in.
 *
 * Bringing a picture and framing it are the same flow rather than two, which is what stops "add a
 * cover" and "reposition a cover" drifting apart the first time one of them learns about paste.
 *
 * It never uploads and never bakes pixels. The answer is the file the user brought plus where the
 * window sat over it; persisting either is the caller's job.
 */

interface AspectPreset {
  id: string
  labelKey: string
  /** null follows the source, which is what "Original" means. */
  ratio: number | null
}

const ASPECT_PRESETS: readonly AspectPreset[] = [
  { id: "original", labelKey: "ImageEditorAspectOriginal", ratio: null },
  { id: "square", labelKey: "ImageEditorAspectSquare", ratio: 1 },
  { id: "four-three", labelKey: "ImageEditorAspect43", ratio: 4 / 3 },
  { id: "sixteen-nine", labelKey: "ImageEditorAspect169", ratio: 16 / 9 },
]

/** Two aspects this close apart are the same preset; they differ only by float noise. */
const ASPECT_EPSILON = 1e-6

export function ImageEditorDialog({
  request,
  onSettle,
}: {
  request: ImageEditRequest
  onSettle: (result: ImageEditResult | null) => void
}) {
  const t = useT()
  const notes = useCallback((key: string) => t("NotesEditor", key), [t])

  const [src, setSrc] = useState<string | undefined>(request.src)
  const [file, setFile] = useState<File | null>(null)
  /** null until the source has decoded, since the stage cannot be framed before then. */
  const [ratio, setRatio] = useState<number | null>(null)
  const [aspect, setAspect] = useState<number | null>(request.aspect ?? request.crop?.aspect ?? null)
  const [view, setView] = useState<View>(request.crop ? fromCrop(request.crop) : FIT)
  const [over, setOver] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)

  const picker = useRef<HTMLInputElement>(null)
  const body = useRef<HTMLDivElement>(null)

  // Locked only by a shape that could actually frame a picture; NaN or zero from a bad caller
  // falls through to the preset row instead of wedging the dialog on an unusable aspect.
  const locked = typeof request.aspect === "number" && Number.isFinite(request.aspect) && request.aspect > 0

  useEffect(() => {
    if (!src) {
      setRatio(null)
      return
    }
    let live = true
    const probe = new Image()
    probe.onload = () => {
      if (!live) return
      const width = probe.naturalWidth
      const height = probe.naturalHeight
      // A source that decoded to a degenerate size cannot frame anything; treated the same as a
      // source that failed to decode at all.
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        setProblem("ImageEditorLoadFailed")
        return
      }
      const decoded = width / height
      setRatio(decoded)
      // A frame nobody pinned follows the picture it was handed.
      setAspect((current) => current ?? decoded)
      setProblem(null)
    }
    probe.onerror = () => {
      if (live) setProblem("ImageEditorLoadFailed")
    }
    probe.src = src
    return () => {
      live = false
    }
  }, [src])

  // Focus lands inside the dialog on open so the paste below has something to fire on. Without it
  // the event targets the body and the editor underneath claims it, inserting a stray block.
  useEffect(() => {
    body.current?.focus()
  }, [])

  /**
   * Attaches whatever came in, from the picker, a drop or a paste.
   *
   * All three arrive as files, so they land in one place rather than in three near identical
   * handlers that drift apart. The view goes back to fit, since a new picture wearing the old
   * crop is a crop of somewhere nobody chose. An aspect already chosen stays chosen: swapping the
   * file is not a reason to forget a shape picked before the swap.
   */
  const take = useCallback((files: FileList | null | undefined) => {
    const picked = firstImageFile(files)
    if (!picked) return
    const trouble = imageFileProblem(picked)
    if (trouble) {
      setProblem(trouble)
      return
    }
    setProblem(null)
    setSrc(ownSourceUrl(picked))
    setFile(picked)
    setRatio(null)
    setView(FIT)
  }, [])

  // No text input lives anywhere in this dialog, so a file paste landing anywhere in the document
  // while it is open is meant for this frame; claiming it unconditionally cannot steal a paste
  // from a field that does not exist. Capture phase, so it runs before the notes editor's own
  // paste handler ever sees the event.
  useEffect(() => {
    const onDocumentPaste = (event: globalThis.ClipboardEvent) => {
      const files = event.clipboardData?.files
      if (!files || files.length === 0) return
      event.preventDefault()
      event.stopPropagation()
      take(files)
    }
    document.addEventListener("paste", onDocumentPaste, true)
    return () => {
      document.removeEventListener("paste", onDocumentPaste, true)
    }
  }, [take])

  /**
   * A frame in ratio units rather than in pixels.
   *
   * Every formula in the geometry is homogeneous, dividing frame quantities only by each other,
   * so this produces the same crop the stage's real pixel size would. The answer therefore does
   * not depend on how wide the dialog happened to be.
   *
   * Null whenever the ratio or the aspect is not a finite positive number, so `ready` below can
   * never fire off of a NaN or non positive frame.
   */
  const frame: Frame | null = useMemo(() => {
    if (ratio == null || aspect == null) return null
    if (!Number.isFinite(ratio) || ratio <= 0) return null
    if (!Number.isFinite(aspect) || aspect <= 0) return null
    return { fw: aspect, fh: 1, ratio }
  }, [ratio, aspect])

  const ready = src != null && frame != null
  const dirty = view.zoom !== 1 || view.ox !== 0.5 || view.oy !== 0.5

  // Empty when a stored aspect matches no preset, so the row shows none selected rather than
  // highlighting a shape the frame is not.
  const activePreset =
    ASPECT_PRESETS.find(
      (preset) => aspect != null && Math.abs((preset.ratio ?? ratio ?? 0) - aspect) < ASPECT_EPSILON,
    )?.id ?? ""

  const zoomPercent = ((view.zoom - 1) / (ZOOM_MAX - 1)) * 100

  function confirm() {
    if (!frame) return
    onSettle({ file, crop: toCrop(view, frame) })
  }

  // Counted rather than a boolean: moving between the stage and the footer fires leave then enter,
  // and a boolean flickers the overlay off at every internal boundary.
  const surface = {
    onDragEnter: (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setOver((count) => count + 1)
    },
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
    },
    onDragLeave: () => {
      setOver((count) => Math.max(0, count - 1))
    },
    onDrop: (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setOver(0)
      take(event.dataTransfer.files)
    },
    // On the dialog's own subtree rather than on the document, so the editor's clipboard plugin
    // cannot claim a paste meant for this frame.
    onPaste: (event: ClipboardEvent<HTMLDivElement>) => {
      const files = event.clipboardData.files
      if (files.length === 0) return
      event.preventDefault()
      take(files)
    },
  }

  return (
    <Modal
      open
      onClose={() => {
        onSettle(null)
      }}
      width={620}
      title={request.title}
      closeLabel={t("Common", "Close")}
      surface={surface}
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            icon={<AppIcon name="rotate-ccw" size={14} strokeWidth={1.8} />}
            disabled={!ready || !dirty}
            onClick={() => {
              setView(FIT)
            }}
          >
            {notes("ImageEditorReset")}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onSettle(null)
              }}
            >
              {t("Common", "Cancel")}
            </Button>
            <Button size="sm" disabled={!ready} onClick={confirm}>
              {request.confirm ?? t("Common", "Save")}
            </Button>
          </div>
        </>
      }
    >
      <div
        ref={body}
        tabIndex={-1}
        className="flex min-w-0 flex-1 flex-col gap-3 px-5 pb-4 pt-1 outline-none"
      >
        {src != null && frame != null ? (
          <>
            <CropStage
              src={src}
              ratio={frame.ratio}
              aspect={frame.fw / frame.fh}
              view={view}
              onView={setView}
              label={notes("ImageEditorStageLabel")}
            />

            <div className="flex flex-wrap items-center gap-3">
              {!locked && (
                <Segmented
                  className="w-[248px] shrink-0"
                  label={notes("ImageEditorAspect")}
                  value={activePreset}
                  onChange={(id) => {
                    const preset = ASPECT_PRESETS.find((candidate) => candidate.id === id)
                    if (preset) setAspect(preset.ratio ?? ratio ?? 1)
                  }}
                  options={ASPECT_PRESETS.map((preset) => ({
                    value: preset.id,
                    label: notes(preset.labelKey),
                  }))}
                />
              )}

              <div className="flex min-w-[150px] flex-1 items-center gap-2.5">
                <span className="text-[11.5px] text-ink-3">{notes("ImageEditorZoom")}</span>
                <input
                  type="range"
                  aria-label={notes("ImageEditorZoom")}
                  value={view.zoom}
                  min={1}
                  max={ZOOM_MAX}
                  step={0.01}
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    // The slider has no cursor, so it anchors on the frame centre. Same zoomAt as
                    // the wheel, or the two disagree about where the picture went.
                    setView((current) => zoomAt(current, next, frame.fw / 2, frame.fh / 2, frame))
                  }}
                  className="slider h-1.5 w-full cursor-pointer appearance-none rounded-full"
                  style={{
                    background: `linear-gradient(to right, var(--solid) ${String(zoomPercent)}%, var(--canvas-sunken) ${String(zoomPercent)}%)`,
                  }}
                />
              </div>
            </div>
          </>
        ) : (
          <div className="flex h-[240px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line bg-canvas-sunken">
            {src && problem == null ? (
              <p className="text-[13px] text-ink-3">{notes("ImageEditorReading")}</p>
            ) : (
              <>
                <AppIcon name="image-plus" size={24} strokeWidth={1.6} className="text-ink-icon" />
                <Button
                  variant="outline"
                  onClick={() => {
                    picker.current?.click()
                  }}
                >
                  {notes("ImageEditorChoose")}
                </Button>
                <p className="text-[11.5px] text-ink-3">{notes("ImageEditorDropHint")}</p>
              </>
            )}
          </div>
        )}

        {problem && <p className="text-[11.5px] text-danger">{notes(problem)}</p>}

        <input
          ref={picker}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES}
          hidden
          onChange={(event) => {
            take(event.target.files)
            // Cleared so choosing the same file twice in a row still fires a change.
            event.target.value = ""
          }}
        />
      </div>

      {over > 0 && (
        <div className="animate-fade-in pointer-events-none absolute inset-0 z-20 p-2.5">
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-accent bg-accent-wash/85">
            <AppIcon name="image-plus" size={24} strokeWidth={1.7} className="text-accent-ink" />
            <p className="text-[14px] font-medium text-ink">
              {notes(src ? "ImageEditorDropToReplace" : "ImageEditorDropToAdd")}
            </p>
          </div>
        </div>
      )}
    </Modal>
  )
}
