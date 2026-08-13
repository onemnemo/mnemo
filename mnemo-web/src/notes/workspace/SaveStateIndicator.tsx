import { AppIcon } from '@/components/icon/AppIcon';
import { useT } from '@/i18n/useT';
import { cn } from '@/lib/utils';

import type { SaveState } from '../authority/authority';
import { describeSaveState } from './save-state-view';

/**
 * What the note chrome says about where your work stands.
 *
 * Plain low-contrast text, not a pill or a badge: with autosave off this is on
 * screen for the whole session and anything with a shape to it would be a
 * permanent decoration. Loud only for a failure or a conflict, where the text on
 * screen is not the text on disk and only the user can decide what to do. The
 * states that show nothing are decided in {@link describeSaveState}, so opening
 * a note never flashes a save that did not happen.
 *
 * It sits in a right-anchored row with the pane actions last, so the label grows
 * leftwards into empty chrome as the wording changes length and nothing beside
 * it moves. It also cannot flicker per keystroke: the first edit takes the state
 * to `dirty` and every edit after it is the same state, which the session drops
 * rather than re-rendering.
 */
export function SaveStateIndicator({
  state,
  autosave,
  onReload,
  onSave,
}: {
  state: SaveState;
  /** Whether the editor is writing the note on its own. */
  autosave: boolean;
  onReload: () => void;
  onSave: () => void;
}) {
  const t = useT();
  const nt = (key: string) => t('Notes', key);
  const view = describeSaveState(state, { autosave });
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
      data-testid="save-state"
      data-save-state={state}
      title={view.descriptionKey ? nt(view.descriptionKey) : undefined}
    >
      {view.tone === 'danger' ? (
        <AppIcon name="common/triangle-alert" size={12} className={cn('shrink-0', toneClass)} />
      ) : null}
      <span className={cn('whitespace-nowrap text-right font-mono text-[10.5px]', toneClass)}>
        {nt(view.labelKey)}
      </span>
      {view.showRetrySave ? <ChromeButton label={nt('Retry')} onClick={onSave} /> : null}
      {view.showReload ? <ChromeButton label={nt('SaveStateReload')} onClick={onReload} /> : null}
    </span>
  );
}

function ChromeButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border border-line px-1.5 py-0.5 text-[10.5px] font-medium text-text-secondary hover:bg-[var(--widget-background-hover)] hover:text-text-primary"
    >
      {label}
    </button>
  );
}
