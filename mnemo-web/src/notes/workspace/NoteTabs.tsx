import { AppIcon } from '@/components/icon/AppIcon';
import { useT } from '@/i18n/useT';
import { cn } from '@/lib/utils';

import { SidebarExpandButton } from './SidebarExpandButton';

export interface NoteTab {
  readonly id: string;
  readonly title: string;
  readonly emoji: string | null;
}

/**
 * Tabs for the editor pane. The tree stays put, so switching a tab changes the
 * one document region rather than the whole screen. The active tab lifts onto
 * the canvas colour and the rest sit back into the bar, so the state reads from
 * shape and elevation instead of a border.
 */
export function NoteTabs({
  tabs,
  activeId,
  onSelect,
  onClose,
  onExpandSidebar,
}: {
  tabs: readonly NoteTab[];
  activeId?: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  /** Present only while the tree is collapsed: the bar hosts the reopen control. */
  onExpandSidebar?: () => void;
}) {
  const t = useT();
  const nt = (key: string, params?: Record<string, string | number>) => t('Notes', key, params);

  return (
    <div className="scroll-thin flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-divider-subtle bg-surface px-1.5">
      {onExpandSidebar ? <SidebarExpandButton onExpand={onExpandSidebar} className="mr-0.5" /> : null}
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(tab.id)}
            className={cn(
              'group/tab flex h-7 min-w-0 max-w-[210px] shrink-0 cursor-pointer items-center gap-1.5 rounded-lg pl-2.5 pr-1 transition-colors',
              active
                ? 'bg-canvas text-text-primary shadow-[0_1px_2px_rgb(0_0_0/0.06),0_0_0_1px_var(--line-soft)]'
                : 'text-text-secondary hover:bg-frame-hover hover:text-text-primary',
            )}
          >
            {tab.emoji ? (
              <span aria-hidden className="shrink-0 text-[12px] leading-none">{tab.emoji}</span>
            ) : (
              <AppIcon name="common/file-text" size={12} className="shrink-0 text-text-faded" preserveColors={false} />
            )}
            <span className={cn('truncate text-[12.5px]', active ? 'font-medium' : 'font-normal')}>{tab.title}</span>
            <button
              type="button"
              aria-label={nt('CloseTabFormat', { 0: tab.title })}
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.id);
              }}
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-md text-text-faded hover:bg-frame-active hover:text-text-primary',
                active ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100',
              )}
            >
              <AppIcon name="common/x" size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
