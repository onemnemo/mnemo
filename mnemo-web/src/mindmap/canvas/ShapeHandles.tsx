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

export function ResizeHandles() {
  return (
    <>
      {HANDLES.map((handle) => (
        <span
          key={handle.dir}
          data-mm-handle={handle.dir}
          className={cn(
            "absolute hidden size-[9px] rounded-[2px] border border-accent bg-canvas",
            "group-data-[selected=one]:block",
          )}
          style={{
            left: `${handle.x * 100}%`,
            top: `${handle.y * 100}%`,
            transform: `translate(-50%, -50%) ${UNSCALE}`,
            cursor: handle.cursor,
          }}
          aria-hidden
        />
      ))}
    </>
  )
}

const ROTATE_DROP = 22

export function RotateHandle({ label, value }: { label: string; value: number }) {
  return (
    <span
      className="absolute left-1/2 top-full hidden group-data-[selected=one]:block"
      style={{
        transform: `translateX(-50%) ${UNSCALE}`,
        transformOrigin: "top center",
      }}
    >
      <span className="mx-auto block w-px bg-accent" style={{ height: ROTATE_DROP - 7 }} />
      <span
        data-mm-handle="rotate"
        title={label}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={Math.round(value)}
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
        role="slider"
        tabIndex={0}
        className="grid size-[14px] cursor-grab place-items-center rounded-full border border-accent bg-canvas text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <AppIcon name="rotate-cw" size={8} strokeWidth={2} />
      </span>
    </span>
  )
}
