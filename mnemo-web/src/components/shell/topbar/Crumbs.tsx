// Current-page trail. For now a single current crumb; a parent-linked trail
// (mirroring ITopbarTrailService) lands with the per-module views.
export function Crumbs({ title }: { title: string }) {
  return (
    <div className="mr-3.5 flex items-center gap-2">
      <span className="text-[12.5px] font-medium text-text-primary">{title}</span>
    </div>
  )
}
