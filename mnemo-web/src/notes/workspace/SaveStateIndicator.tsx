import { AppIcon } from '@/components/icon/AppIcon';
import { useT } from '@/i18n/useT';
import { cn } from '@/lib/utils';

import type { SaveState } from '../authority/authority';
import { describeSaveState } from './save-state-view';

/**
 * What the breadcrumb says about where your work stands.
 *
 * Quiet by default, because a note saving normally is not news; loud only for a
 * failure or a conflict, where the text on screen is not the text on disk and
 * only the user can decide what to do. The states that show nothing are decided
 * in {@link describeSaveState}, so opening a note never flashes a save that did
 * not happen.
 */
export function SaveStateIndicator({ state, onReload }: { state: SaveState; onReload: () => void }) {
  const t = useT();
  const nt = (key: string) => t('Notes', key);
  const view = describeSaveState(state);
  if (!view) return null;

  const toneClass =
    view.tone === 'danger'
      ? 'text-destructive'
      : view.tone === 'warning'
        ? 'text-[var(--toast-accent-warning)]'
        : 'text-text-faded';

  return (
    <span
      className="flex items-center gap-1.5"
      title={view.descriptionKey ? nt(view.descriptionKey) : undefined}
    >
      {view.tone === 'danger' ? (
        <AppIcon name="common/triangle-alert" size={12} className={cn('shrink-0', toneClass)} />
      ) : null}
      <span className={cn('whitespace-nowrap font-mono text-[10.5px]', toneClass)}>{nt(view.labelKey)}</span>
      {view.showReload ? (
        <button
          type="button"
          onClick={onReload}
          className="rounded border border-line px-1.5 py-0.5 text-[10.5px] font-medium text-text-secondary hover:bg-[var(--widget-background-hover)] hover:text-text-primary"
        >
          {nt('SaveStateReload')}
        </button>
      ) : null}
    </span>
  );
}
