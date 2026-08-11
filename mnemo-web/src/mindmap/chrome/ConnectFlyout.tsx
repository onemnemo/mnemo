import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import type { ArrowCap, EdgeRouting, LineStyle } from "../model/document"
import { FlyoutPanel } from "./FlyoutPanel"

const LINES: readonly { value: LineStyle; key: string }[] = [
  { value: "solid", key: "EdgeSolid" },
  { value: "dashed", key: "EdgeDashed" },
  { value: "dotted", key: "EdgeDotted" },
  { value: "double", key: "EdgeDouble" },
]

const ROUTES: readonly { value: EdgeRouting; key: string }[] = [
  { value: "curve", key: "RouteCurve" },
  { value: "straight", key: "RouteStraight" },
  { value: "orthogonal", key: "RouteOrthogonal" },
]

const CAPS: readonly { value: ArrowCap; key: string }[] = [
  { value: "none", key: "CapNone" },
  { value: "arrow", key: "CapArrow" },
  { value: "dot", key: "CapDot" },
]

/**
 * What the connect tool draws with.
 *
 * Its own type rather than a slice of `EdgeStyle`, whose members are all nullable: null there means
 * "inherit from the cascade", and a tool default has nothing above it to inherit from.
 */
export interface ConnectStyle {
  line: LineStyle
  routing: EdgeRouting
  startCap: ArrowCap
  endCap: ArrowCap
}

export interface ConnectFlyoutProps {
  style: ConnectStyle
  onStyle: (patch: Partial<ConnectStyle>) => void
  onClose: () => void
}

/**
 * What the connect tool draws with, set before drawing rather than corrected after.
 *
 * Start and end caps are two controls rather than one with four values. The model has always carried
 * them separately, and the owner asked for arrows on the left, on the right and on both, which one
 * combined control cannot say without enumerating every pairing.
 */
export function ConnectFlyout({ style, onStyle, onClose }: ConnectFlyoutProps) {
  const t = useT()

  return (
    <FlyoutPanel onClose={onClose} className="w-[232px]">
      <Group label={t("Mindmap", "GroupLine")}>
        {LINES.map((entry) => (
          <Cell
            key={entry.value}
            label={t("Mindmap", entry.key)}
            active={style.line === entry.value}
            onClick={() => onStyle({ line: entry.value })}
          >
            <LineGlyph line={entry.value} />
          </Cell>
        ))}
      </Group>

      <Group label={t("Mindmap", "GroupRouting")}>
        {ROUTES.map((entry) => (
          <Cell
            key={entry.value}
            label={t("Mindmap", entry.key)}
            active={style.routing === entry.value}
            onClick={() => onStyle({ routing: entry.value })}
          >
            <RouteGlyph routing={entry.value} />
          </Cell>
        ))}
      </Group>

      <Group label={t("Mindmap", "GroupCaps")}>
        <CapRow
          label={t("Mindmap", "CapStart")}
          value={style.startCap}
          onPick={(cap) => onStyle({ startCap: cap })}
          flipped
        />
        <CapRow
          label={t("Mindmap", "CapEnd")}
          value={style.endCap}
          onPick={(cap) => onStyle({ endCap: cap })}
        />
      </Group>
    </FlyoutPanel>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="px-1 pb-1.5 last:pb-0.5">
      <h3 className="px-0.5 py-1 text-[9.5px] font-semibold tracking-[0.06em] text-ink-3">{label}</h3>
      <div className="flex gap-1">{children}</div>
    </section>
  )
}

function Cell({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "grid h-7 flex-1 place-items-center rounded-lg transition-colors duration-120",
        active ? "bg-frame-active text-ink" : "text-ink-2 hover:bg-frame-hover hover:text-ink",
      )}
    >
      {children}
    </button>
  )
}

function CapRow({
  label,
  value,
  onPick,
  flipped,
}: {
  label: string
  value: ArrowCap
  onPick: (cap: ArrowCap) => void
  flipped?: boolean
}) {
  const t = useT()
  return (
    <div className="flex flex-1 items-center gap-1">
      <span className="w-[30px] shrink-0 text-[10.5px] text-ink-3">{label}</span>
      {CAPS.map((cap) => (
        <Cell
          key={cap.value}
          label={`${label} ${t("Mindmap", cap.key)}`}
          active={value === cap.value}
          onClick={() => onPick(cap.value)}
        >
          <CapGlyph cap={cap.value} flipped={flipped} />
        </Cell>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Glyphs                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Drawn here rather than pulled from the icon set.
 *
 * None of these are icons: each one is a sample of the thing it sets, drawn by the same rules the
 * canvas draws it by, which is the only way a picker can be trusted to show what you are about to get.
 */
function LineGlyph({ line }: { line: LineStyle }) {
  if (line === "double") {
    return (
      <svg width={22} height={12} aria-hidden>
        <path d="M1 4.5 H21 M1 7.5 H21" stroke="currentColor" strokeWidth={1.3} fill="none" />
      </svg>
    )
  }
  return (
    <svg width={22} height={12} aria-hidden>
      <path
        d="M1 6 H21"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeDasharray={line === "dashed" ? "5 3" : line === "dotted" ? "0.5 3" : undefined}
        fill="none"
      />
    </svg>
  )
}

function RouteGlyph({ routing }: { routing: EdgeRouting }) {
  const d =
    routing === "curve"
      ? "M1 11 C8 11 8 1 21 1"
      : routing === "straight"
        ? "M1 11 L21 1"
        : "M1 11 H11 V1 H21"
  return (
    <svg width={22} height={12} aria-hidden>
      <path d={d} stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

function CapGlyph({ cap, flipped }: { cap: ArrowCap; flipped?: boolean }) {
  return (
    <svg width={20} height={12} aria-hidden transform={flipped ? "scale(-1, 1)" : undefined}>
      <path d="M2 6 H14" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" fill="none" />
      {cap === "arrow" ? <path d="M12 2.5 L18 6 L12 9.5 Z" fill="currentColor" /> : null}
      {cap === "dot" ? <circle cx={15} cy={6} r={2.6} fill="currentColor" /> : null}
    </svg>
  )
}
