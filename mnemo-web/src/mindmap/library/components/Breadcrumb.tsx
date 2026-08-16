import { Fragment, useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import type { Crumb } from "../shelf"

/**
 * The trail back out of a folder, and the only way to file a map upward.
 *
 * Every crumb takes a drop, including the root, so moving a map out of a folder is the same gesture
 * as moving one in. Without that a map could go down the tree and never come back up without a menu.
 */
export function Breadcrumb({
  crumbs,
  onOpen,
  onDropMap,
}: {
  crumbs: readonly Crumb[]
  onOpen: (folderId: string | null) => void
  onDropMap: (mapId: string, folderId: string | null) => void
}) {
  const t = useT()
  const parent = crumbs.length >= 2 ? crumbs[crumbs.length - 2].id : null

  return (
    <nav className="flex items-center gap-1 text-[12.5px]">
      <button
        type="button"
        onClick={() => onOpen(parent)}
        title={t("Mindmap", "Back")}
        aria-label={t("Mindmap", "Back")}
        className="grid size-6 place-items-center rounded-md text-ink-2 transition-colors hover:bg-frame-hover hover:text-ink"
      >
        <AppIcon name="common/chevron-left" size={14} />
      </button>

      <CrumbButton label={t("Mindmap", "Title")} onOpen={() => onOpen(null)} onDropMap={(id) => onDropMap(id, null)} />

      {crumbs.map((crumb, index) => (
        <Fragment key={crumb.id ?? index}>
          <span aria-hidden className="text-ink-3">
            /
          </span>
          <CrumbButton
            label={crumb.name}
            current={index === crumbs.length - 1}
            onOpen={() => onOpen(crumb.id)}
            onDropMap={(id) => onDropMap(id, crumb.id)}
          />
        </Fragment>
      ))}
    </nav>
  )
}

function CrumbButton({
  label,
  current,
  onOpen,
  onDropMap,
}: {
  label: string
  current?: boolean
  onOpen: () => void
  onDropMap: (mapId: string) => void
}) {
  const [over, setOver] = useState(false)

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={current ? "page" : undefined}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = "move"
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        setOver(false)
        const id = event.dataTransfer.getData("text/plain")
        if (id) {
          onDropMap(id)
        }
      }}
      className={cn(
        "max-w-[220px] truncate rounded-md px-1.5 py-0.5 transition-colors",
        over && "bg-accent-wash text-accent-ink",
        !over && (current ? "text-ink" : "text-ink-2 hover:bg-frame-hover hover:text-ink"),
      )}
    >
      {label}
    </button>
  )
}
