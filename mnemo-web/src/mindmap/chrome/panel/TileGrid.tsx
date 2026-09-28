import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export interface Tile<T> {
  value: T
  label: string
  preview: ReactNode
}

/** Labelled preview tiles, one per value, the picked one pressed. */
export function TileGrid<T extends string>({
  tiles,
  value,
  height,
  onPick,
}: {
  tiles: readonly Tile<T>[]
  value: T
  /** Tile height in px. */
  height: number
  onPick: (value: T) => void
}) {
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}>
      {tiles.map((tile) => {
        const on = tile.value === value
        return (
          <button
            key={tile.value}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(tile.value)}
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-[11px] px-1 outline-none",
              "text-center text-[11.5px] leading-tight font-medium",
              "transition-colors duration-(--duration-press) ease-[ease] focus-visible:ring-2 focus-visible:ring-accent",
              on ? "bg-frame-active text-ink" : "text-ink-2 hover:bg-frame-hover hover:text-ink",
            )}
            style={{ height }}
          >
            {tile.preview}
            {tile.label}
          </button>
        )
      })}
    </div>
  )
}
