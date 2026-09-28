/** Host-local handles follow direct DOM edits and undo the inherited camera zoom. */

import { AppIcon } from "@/components/icon/AppIcon"
import { cn } from "@/lib/utils"

const HANDLES = [
  { dir: "nw", x: 0, y: 0, cursor: "nwse-resize" },
  { dir: "n", x: 0.5, y: 0, cursor: "ns-resize" },
  { dir: "ne", x: 1, y: 0, cursor: "nesw-resize" },
  { dir: "e", x: 1, y: 0.5, cursor: "ew-resize" },
  { dir: "se", x: 1, y: 1, cursor: "nwse-resize" },
  { dir: "s", x: 0.5, y: 1, cursor: "ns-resize" },
  { dir: "sw", x: 0, y: 1, cursor: "nesw-resize" },
  { dir: "w", x: 0, y: 0.5, cursor: "ew-resize" },
] as const

const UNSCALE = "scale(calc(1 / var(--mm-zoom, 1)))"

/** How far above the top edge the rotate knob's centre sits, in screen pixels. */
const KNOB_LIFT = 26

/**
 * An SVG stroke over the zoom: a border rounds up under 1px, and non-scaling-stroke misses the
 * camera's CSS scale. Sized by CSS so it follows a box a live resize wrote to the host.
 */
export function SelectionBox({ editing, hover }: { editing?: boolean; hover: boolean }) {
  return (
    <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden>
      <rect
        data-mm-selection-box=""
        width="100%"
        height="100%"
        fill="none"
        className={cn(
          editing
            ? "stroke-accent"
            : cn(
                "hidden stroke-(--sel-lasso-line) group-data-[selected]:inline group-data-[selected]:stroke-accent",
                hover && "group-hover:inline",
              ),
        )}
        style={{ strokeWidth: "calc(1.25px / var(--mm-zoom, 1))" }}
      />
    </svg>
  )
}

export function ResizeHandles() {
  return (
    <>
      {HANDLES.map((handle) => (
        <span
          key={handle.dir}
          data-mm-handle={handle.dir}
          className={cn(
            "absolute hidden size-2 rounded-[2px] border-[1.25px] border-accent bg-canvas shadow-handle",
            "transition-colors duration-100 hover:bg-accent data-[mm-active]:bg-accent",
            "before:absolute before:-inset-[7px] before:content-['']",
            "group-data-[selected=one]:block",
          )}
          style={{
            left: `${handle.x * 100}%`,
            top: `${handle.y * 100}%`,
            transformOrigin: "0 0",
            transform: `${UNSCALE} translate(-50%, -50%)`,
            cursor: handle.cursor,
          }}
          aria-hidden
        />
      ))}
    </>
  )
}

export function RotateHandle({ label, value }: { label: string; value: number }) {
  return (
    <span
      data-mm-handle="rotate"
      title={label}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={Math.round(value) % 360}
      aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
      role="slider"
      tabIndex={0}
      className={cn(
        "absolute left-1/2 top-0 hidden size-4 cursor-grab place-items-center rounded-full",
        "border-[1.25px] border-accent bg-canvas text-accent shadow-handle",
        "transition-colors duration-100 hover:bg-accent hover:text-canvas data-[mm-active]:bg-accent data-[mm-active]:text-canvas",
        "before:absolute before:-inset-1.5 before:rounded-full before:content-['']",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "group-data-[selected=one]:grid",
      )}
      style={{
        // Scaled first, so the lift and the centring are screen pixels.
        transformOrigin: "0 0",
        transform: `${UNSCALE} translate(-50%, calc(-50% - ${KNOB_LIFT}px))`,
      }}
    >
      <AppIcon name="rotate-cw" size={10} strokeWidth={2} />
    </span>
  )
}
