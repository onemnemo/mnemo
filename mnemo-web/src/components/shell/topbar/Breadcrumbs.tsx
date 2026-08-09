import { AppIcon } from "@/components/icon/AppIcon"
import { cn } from "@/lib/utils"
import type { Crumb } from "@/nav/trail"

const ELLIPSIS = "…"

/**
 * Deep trails collapse in the middle rather than shrinking every segment to
 * illegibility. The root and the last two survive, because those are the ones
 * people navigate by.
 */
function collapse(crumbs: Crumb[]): Array<Crumb | null> {
  if (crumbs.length <= 4) return crumbs
  return [crumbs[0], null, ...crumbs.slice(-2)]
}

function Separator() {
  return <AppIcon name="chevron-right" size={14} strokeWidth={2} className="shrink-0 text-ink-3/70" />
}

export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  const shown = collapse(crumbs)

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-0.5">
      {shown.map((crumb, index) => {
        const last = index === shown.length - 1

        if (crumb === null) {
          return (
            <div key="ellipsis" className="flex shrink-0 items-center gap-0.5">
              <Separator />
              <span className="px-1.5 py-1 text-[14px] text-ink-3">{ELLIPSIS}</span>
            </div>
          )
        }

        const content = (
          <>
            {crumb.icon && <AppIcon name={crumb.icon} size={16} className="shrink-0 text-ink-icon" />}
            {/* The deepest crumb is the one worth keeping legible, so the
                ancestors give way first. */}
            <span className={cn("truncate", !last && "min-w-[2.5rem]")}>{crumb.label}</span>
          </>
        )

        const className = cn(
          "flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[14px] tracking-[-0.008em] transition-colors",
          last ? "font-medium text-ink" : "shrink text-ink-2 hover:bg-frame-hover hover:text-ink",
        )

        return (
          <div key={`${crumb.label}-${index}`} className="flex min-w-0 shrink items-center gap-0.5">
            {index > 0 && <Separator />}
            {crumb.href && !last ? (
              <a href={crumb.href} title={crumb.label} className={className} style={{ transitionDuration: "var(--duration-fast)" }}>
                {content}
              </a>
            ) : (
              <span title={crumb.label} className={className}>
                {content}
              </span>
            )}
          </div>
        )
      })}
    </nav>
  )
}
