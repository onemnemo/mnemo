import type { ReactNode } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import type { IconName } from "@/components/icon/icon-registry"
import { cn } from "@/lib/utils"

/**
 * The centered "nothing here yet" panel, ported from the desktop EmptyState:
 * a boxed icon, a title, a line of guidance and an optional single action.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: IconName
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("mx-auto flex max-w-[360px] flex-col items-center gap-3 text-center", className)}>
      <div className="grid size-14 place-items-center rounded-xl border border-line bg-surface-subtle text-text-faded">
        <AppIcon name={icon} size={22} />
      </div>
      <h2 className="text-heading-6 font-semibold text-text-primary">{title}</h2>
      {description ? <p className="text-body-small text-text-tertiary">{description}</p> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  )
}
