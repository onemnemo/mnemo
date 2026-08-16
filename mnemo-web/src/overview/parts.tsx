import type { ReactNode } from "react"

import { RouteLink } from "@/app/RouteLink"
import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import type { WidgetManifest } from "./widgets/manifest"

/** The widget's own display name. Every widget draws its own heading, so every widget needs this. */
export function useWidgetTitle(manifest: WidgetManifest): string {
  return useT()(manifest.ns, manifest.displayNameKey ?? "Title")
}

/**
 * The pieces every widget is built from.
 *
 * The tile frame deliberately owns none of this. A fixed title row forced every
 * widget to wear a header whether or not it had anything to put in one, and gave
 * none of them anywhere to put a control. These are shared parts instead: the
 * consistency comes from widgets composing the same pieces, not from a frame
 * imposing them.
 */

/**
 * Every widget's outer padding. Kept in one place because a board where one tile
 * is padded 14px and its neighbour 16px reads as sloppy long before anyone can
 * say why.
 */
export function Body({
  children,
  className,
  href,
  title,
}: {
  children: ReactNode
  className?: string
  /** Makes the whole body one destination. Widgets that are a single place to go use this. */
  href?: string
  title?: string
}) {
  const shared = cn("flex h-full w-full flex-col p-3.5 text-left", href && "transition-colors hover:bg-frame-hover", className)

  if (href) {
    return (
      <RouteLink to={href} title={title} className={shared} style={{ transitionDuration: "var(--duration-fast)" }}>
        {children}
      </RouteLink>
    )
  }
  return (
    <div title={title} className={shared}>
      {children}
    </div>
  )
}

/**
 * The widget's own title.
 *
 * Small and grey on purpose. Set in bold ink, four widgets shout their own names
 * and the data, the only reason any of them exist, comes second. A label should
 * be findable, not loud.
 */
export function Head({
  title,
  icon,
  right,
  className,
}: {
  title: string
  icon?: string
  right?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex shrink-0 items-center gap-1.5", className)}>
      {icon && <AppIcon name={icon} size={14} strokeWidth={1.7} className="text-ink-icon" />}
      <span className="min-w-0 truncate text-[12px] font-medium text-ink-3">{title}</span>
      {right && <div className="ml-auto flex shrink-0 items-center">{right}</div>}
    </div>
  )
}

/** A number that is meant to be read across the room. */
export function Stat({
  value,
  unit,
  scale = 1,
  className,
}: {
  value: ReactNode
  unit?: string
  /** 1 is the standard 30px. 0.8 for cramped tiles, 1.2 for a hero. */
  scale?: number
  className?: string
}) {
  return (
    <p className={cn("flex items-baseline gap-1.5", className)}>
      <span
        className="font-semibold leading-none tracking-[-0.028em] tabular-nums text-ink"
        style={{ fontSize: Math.round(30 * scale) }}
      >
        {value}
      </span>
      {unit && <span className="truncate text-[12.5px] text-ink-2">{unit}</span>}
    </p>
  )
}

/** The quiet line a widget shows when it genuinely has nothing to report. */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center">
      <p className="text-[12.5px] text-ink-3">{children}</p>
    </div>
  )
}

/** The mix of work waiting, as one bar. */
export function MixBar({
  counts,
  className,
}: {
  counts: { new: number; learning: number; due: number }
  className?: string
}) {
  const total = counts.new + counts.learning + counts.due
  const segments = [
    { value: counts.new, className: "bg-state-new" },
    { value: counts.learning, className: "bg-state-learn" },
    { value: counts.due, className: "bg-state-due" },
  ]

  return (
    <span className={cn("flex h-1.5 overflow-hidden rounded-full bg-canvas-sunken", className)}>
      {total > 0 &&
        segments.map((segment, index) =>
          segment.value > 0 ? (
            <span key={index} className={segment.className} style={{ width: `${(segment.value / total) * 100}%` }} />
          ) : null,
        )}
    </span>
  )
}

export function Legend({
  items,
  className,
}: {
  items: Array<{ label: string; dot: string }>
  className?: string
}) {
  return (
    <p className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-2", className)}>
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span className={cn("size-[6px] shrink-0 rounded-full", item.dot)} />
          {item.label}
        </span>
      ))}
    </p>
  )
}

export function Ring({
  value,
  size = 44,
  stroke = 3.5,
  tone = "stroke-ink",
  children,
}: {
  /** 0 to 1, or null for no data. */
  value: number | null
  size?: number
  stroke?: number
  tone?: string
  children?: ReactNode
}) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius

  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90 overflow-visible" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-canvas-sunken" />
        {value !== null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, value)))}
            className={tone}
          />
        )}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center">{children}</span>
    </span>
  )
}

/**
 * A trend line with no axes, no grid and no labels. A sparkline earns its space
 * by showing direction in a glance; the moment it needs a legend it should have
 * been a chart.
 */
export function Spark({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null

  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * 100
    const y = 100 - ((value - min) / span) * 100
    return `${x},${y}`
  })

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={cn("h-full w-full", className)} aria-hidden>
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

export interface Bar {
  key: string
  label?: string
  parts: Array<{ value: number; className: string }>
}

/**
 * Stacked columns on a shared baseline.
 *
 * Flex rather than an SVG, so they stay crisp at any width and reflow when the
 * tile is resized: a chart has to survive going from a 2x1 to a 4x1 without
 * being re-authored.
 */
export function Bars({
  bars,
  labelEvery = 1,
  className,
}: {
  bars: Bar[]
  /** Label every nth column. Thirty days of labels is noise; seven is a week. */
  labelEvery?: number
  className?: string
}) {
  const totals = bars.map((bar) => bar.parts.reduce((sum, part) => sum + part.value, 0))
  const max = Math.max(1, ...totals)

  return (
    <div className={cn("flex min-h-0 flex-1 items-stretch gap-[3px]", className)}>
      {bars.map((bar, index) => (
        <div key={bar.key} className="flex min-w-0 flex-1 flex-col justify-end gap-1">
          <div
            title={`${bar.label ?? ""}: ${totals[index]}`}
            className="flex w-full flex-col justify-end overflow-hidden rounded-[3px]"
            style={{ height: `${(totals[index] / max) * 100}%`, minHeight: totals[index] > 0 ? 2 : 0 }}
          >
            {bar.parts.map((part, partIndex) =>
              part.value > 0 ? (
                <span
                  key={partIndex}
                  className={part.className}
                  style={{ height: `${(part.value / (totals[index] || 1)) * 100}%` }}
                />
              ) : null,
            )}
          </div>
          <span className="h-3 truncate text-center text-[9.5px] leading-3 text-ink-3">
            {index % labelEvery === 0 ? bar.label : ""}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * One line of a list widget. The meta column is fixed to the right and never
 * wraps, so five rows read as a table rather than five ragged sentences.
 */
export function ItemRow({
  glyph,
  title,
  meta,
  href,
}: {
  glyph: ReactNode
  title: string
  meta?: string
  href?: string
}) {
  const className =
    "-mx-1.5 flex h-[26px] w-full shrink-0 items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-frame-hover"
  const content = (
    <>
      <span className="grid size-[15px] shrink-0 place-items-center text-[13px] leading-none">{glyph}</span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{title}</span>
      {meta && <span className="shrink-0 text-[11.5px] tabular-nums text-ink-3">{meta}</span>}
    </>
  )

  if (href) {
    return (
      <RouteLink to={href} title={title} className={className} style={{ transitionDuration: "var(--duration-fast)" }}>
        {content}
      </RouteLink>
    )
  }
  return <div className={className}>{content}</div>
}
