import { useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

import { useT } from '@/i18n/useT';
import { pasteProgressSnapshot, subscribePasteProgress } from './paste-progress';

/**
 * The paste staging overlay: a small centred card shown while pasted images are
 * being restaged, with a way to cancel.
 *
 * It is portalled to the document body, never into the editor's DOM, so
 * ProseMirror's MutationObserver never sees it and never rebuilds a NodeView
 * because of it. It reads the shared progress store the paste path writes, so it
 * needs no props and can sit anywhere in the surface that has the i18n bundle.
 */
export function PasteProgressOverlay() {
  const t = useT();
  const snapshot = useSyncExternalStore(
    subscribePasteProgress,
    pasteProgressSnapshot,
    pasteProgressSnapshot,
  );

  const onCancel = snapshot.onCancel;
  useEffect(() => {
    if (!onCancel) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  if (!snapshot.active) return null;

  const nt = (key: string, params?: Record<string, string | number>) => t('Notes', key, params);
  const label =
    snapshot.total > 1
      ? nt('editor.clipboard.pasteStagingImages', { 0: snapshot.done, 1: snapshot.total })
      : nt('editor.clipboard.pasteStagingImage');

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] grid place-items-center bg-black/30"
      role="status"
      aria-live="polite"
    >
      <div className="flex min-w-[240px] flex-col gap-3 rounded-lg border border-line bg-popover px-5 py-4 shadow-elevation-4">
        <div className="flex items-center gap-2.5 text-body-medium text-text-primary">
          <span
            className="size-4 shrink-0 animate-spin rounded-full border-2 border-text-faded border-t-transparent"
            aria-hidden
          />
          {label}
        </div>
        {onCancel ? (
          <button
            type="button"
            onClick={() => onCancel()}
            className="self-end rounded-md px-2 py-1 text-body-small text-text-secondary hover:bg-surface-subtle hover:text-text-primary"
          >
            {nt('editor.clipboard.pasteCancel')}
          </button>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
