import { AppIcon } from "@/components/icon/AppIcon"

/**
 * The dashed tile that sits after the last card inside a folder.
 *
 * Only inside a folder, and only when nothing is being searched for: at the root the New button in
 * the header is already in view, and a create affordance mixed into filtered results reads as a
 * result that matched.
 */
export function NewTile({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-full min-h-[186px] w-full flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed border-line text-ink-2 transition-colors hover:border-accent hover:bg-accent-wash/40"
    >
      <span className="grid size-[34px] place-items-center rounded-lg bg-canvas-sunken text-accent transition-colors group-hover:bg-canvas">
        <AppIcon name="plus" size={18} strokeWidth={1.9} />
      </span>
      <span className="max-w-[80%] truncate text-[12.5px] font-medium">{label}</span>
    </button>
  )
}
