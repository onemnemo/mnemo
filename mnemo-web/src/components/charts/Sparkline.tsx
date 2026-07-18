/**
 * A trend line with a dot on its latest point. Values are percentages, plotted against a fixed
 * 0..100 range rather than against their own spread, so two sparklines drawn side by side mean
 * the same thing and a run of near-identical scores stays flat instead of looking dramatic.
 */
export function Sparkline({
  values,
  width = 240,
  height = 48,
  className = "text-[var(--flashcard-state-learning)]",
  dotClassName = "text-brand",
}: {
  values: number[]
  width?: number
  height?: number
  className?: string
  dotClassName?: string
}) {
  if (values.length < 2) return null

  // Inset so neither the stroke nor the end dot is clipped by the viewBox.
  const pad = 4
  const innerWidth = Math.max(1, width - pad * 2)
  const innerHeight = Math.max(1, height - pad * 2)

  const points = values.map((value, i) => {
    const x = pad + (innerWidth * i) / (values.length - 1)
    const y = pad + innerHeight * (1 - Math.min(Math.max(value, 0), 100) / 100)
    return { x, y }
  })

  const last = points[points.length - 1]

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polyline
        points={points.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
      />
      <circle cx={last.x} cy={last.y} r={3} fill="currentColor" className={dotClassName} />
    </svg>
  )
}
