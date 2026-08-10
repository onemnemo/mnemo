import { AppIcon } from '@/components/icon/AppIcon';
import { useT } from '@/i18n/useT';
import { cn } from '@/lib/utils';

/**
 * Reopens the tree when it is collapsed. With the breadcrumb bar gone there is no
 * fixed strip to hold this, so it rides the tabs bar as a leading control and
 * pins to the empty pane otherwise.
 */
export function SidebarExpandButton({ onExpand, className }: { onExpand: () => void; className?: string }) {
  const t = useT();
  const label = t('Notes', 'ExpandSidebar');
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onExpand}
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-md text-ink-icon transition-colors hover:bg-frame-hover hover:text-ink',
        className,
      )}
    >
      <AppIcon name="common/layout-sidebar" size={15} />
    </button>
  );
}
