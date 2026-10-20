import type { ReactNode } from 'react';

import { AppIcon } from '@/components/icon/AppIcon';

import { useNotesT } from './useNotesT';

/** The note icon. A note with children shows the fold arrow in its place on hover. */
export function ChildToggle({
  icon,
  expanded,
  toggleable,
  onToggle,
}: {
  icon: ReactNode;
  expanded: boolean;
  toggleable: boolean;
  onToggle: () => void;
}) {
  const nt = useNotesT();
  if (!toggleable) return <span className="grid size-4 shrink-0 place-items-center">{icon}</span>;
  return (
    <span
      aria-hidden
      title={expanded ? nt('CollapseChildren') : nt('ExpandChildren')}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      // Not focusable. A focus move mid-press re-renders the row and loses the click.
      onMouseDown={(event) => event.preventDefault()}
      onDoubleClick={(event) => event.stopPropagation()}
      className="-mx-0.5 grid size-5 shrink-0 place-items-center rounded text-ink-icon hover:bg-frame-active hover:text-ink"
    >
      <span className="col-start-1 row-start-1 grid place-items-center group-hover:hidden">
        {icon}
      </span>
      <span className="col-start-1 row-start-1 hidden group-hover:grid">
        <AppIcon name={expanded ? 'common/chevron-down' : 'common/chevron-right'} size={12} />
      </span>
    </span>
  );
}
