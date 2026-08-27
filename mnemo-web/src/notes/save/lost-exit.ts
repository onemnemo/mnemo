/**
 * Reports an unsuccessful final note save to the user and host log. There is no recovery draft
 * after the session is released.
 */

import { apiSend } from '@/api/client';
import { useI18nStore } from '@/i18n/store';
import { createTranslate } from '@/i18n/translate';
import { toast } from '@/stores/toast';
import type { SaveResult } from '../authority/authority';
import { readCachedNoteTitle } from '../api';

/** Which exit the note was on when its last write answered. */
export type LostSaveTrigger = 'close' | 'shutdown';

/** Why the write did not land. Mirrors the host's own closed set. */
export type LostSaveVerdict = 'failed' | 'conflict';

/**
 * Maps failed or conflicted saves to a loss verdict. Returns null for saved or skipped results;
 * callers must handle stillDirty before releasing the document.
 */
export function lostSaveVerdict(result: SaveResult): LostSaveVerdict | null {
  if (result.status === 'failed') return 'failed';
  if (result.status === 'conflict') return 'conflict';
  return null;
}

/**
 * Shows a persistent warning and reports the failure to the host. Each attempt is independent and
 * neither may throw into caller cleanup.
 */
export async function reportLostSave(
  noteId: string,
  result: SaveResult,
  trigger: LostSaveTrigger,
): Promise<void> {
  const verdict = lostSaveVerdict(result);
  if (!verdict) return;

  try {
    const t = createTranslate(useI18nStore.getState().bundle);
    const title = readCachedNoteTitle(noteId)?.trim() || t('Notes', 'Untitled');
    toast.warning(t('Notes', 'SaveLostTitle', { 0: title }), {
      description: t(
        'Notes',
        verdict === 'conflict' ? 'SaveLostConflictDescription' : 'SaveLostFailedDescription',
      ),
      // Keep the warning visible until dismissed.
      durationMs: 0,
    });
  } catch {
    // A toast failure must not prevent host reporting or caller cleanup.
  }

  try {
    await apiSend('/app/save-lost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Send the identifier only; titles may contain private content.
      body: JSON.stringify({ noteId, verdict, trigger }),
    });
  } catch (error) {
    // Log refusal by an incompatible host for diagnosis.
    console.error('[notes] could not tell the host about a lost save', error);
  }
}
