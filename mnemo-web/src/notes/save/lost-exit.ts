/**
 * Reports an unsuccessful final note save to the user and host log. There is no recovery draft
 * after the session is released.
 */

import { apiSend } from '@/api/client';
import { shutdownTimeLeftMs } from '@/app/shutdown';
import { useI18nStore } from '@/i18n/store';
import { createTranslate } from '@/i18n/translate';
import { toast } from '@/stores/toast';
import type { SaveResult } from '../authority/authority';
import { readCachedNoteTitle } from '../api';

/** Which exit the note was on when its last write answered. */
export type LostSaveTrigger = 'close' | 'shutdown';

/**
 * Why the write did not land, or did not carry everything. Mirrors the host's own closed set.
 * `incomplete` is a write that landed while typing went on past it, so its last edits are not in it.
 */
export type LostSaveVerdict = 'failed' | 'conflict' | 'incomplete';

/** The longest an exit waits for the second write, the one chasing typing the first missed. */
export const EXIT_RETRY_WAIT_MS = 3_000;

/** What a shutdown keeps back from that wait, so the report and the ready answer still land. */
export const EXIT_REPORT_MARGIN_MS = 500;

/** The longest the host report may take, so a stalled request cannot hold an exit open. */
export const EXIT_REPORT_WAIT_MS = 2_000;

/** What the report leaves of a shutdown's time, so the ready answer still lands. */
export const EXIT_READY_MARGIN_MS = 200;

/** The wait for the second write that the running shutdown can still afford. */
export function exitRetryWaitMs(): number {
  return Math.max(0, Math.min(EXIT_RETRY_WAIT_MS, shutdownTimeLeftMs() - EXIT_REPORT_MARGIN_MS));
}

/**
 * Maps an exit's last save to a loss verdict, or null when everything was written. Every caller is
 * an exit with no later flush, so a save that is still dirty is an incomplete one.
 */
export function lostSaveVerdict(result: SaveResult): LostSaveVerdict | null {
  if (result.status === 'failed') return 'failed';
  if (result.status === 'conflict') return 'conflict';
  if (result.status === 'saved' && result.stillDirty) return 'incomplete';
  return null;
}

/**
 * An exit's save: one flush, and a second when typing landed while the first was in the air. Not a
 * third, so the exit always ends. The second is bounded; past the bound the first answer stands,
 * still dirty, and is reported as incomplete rather than dropped.
 */
export async function flushForExit(
  flush: () => Promise<SaveResult>,
  waitMs: () => number = exitRetryWaitMs,
): Promise<SaveResult> {
  const first = await flush();
  if (first.status !== 'saved' || !first.stillDirty) return first;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<SaveResult>((resolve) => {
    timer = setTimeout(() => resolve(first), waitMs());
  });
  try {
    return await Promise.race([flush().catch(() => first), expiry]);
  } finally {
    clearTimeout(timer);
  }
}

const DESCRIPTIONS: Readonly<Record<LostSaveVerdict, string>> = {
  failed: 'SaveLostFailedDescription',
  conflict: 'SaveLostConflictDescription',
  incomplete: 'SaveLostIncompleteDescription',
};

/** Results already reported: a flush joining a close hands back the close's own result. */
const reported = new WeakSet<SaveResult>();

/**
 * Shows a persistent warning, then reports the failure to the host. The warning does not wait on
 * the request; the host log line is the record that outlives a closing window. The request is
 * bounded by what the running shutdown can afford. Neither attempt may throw into caller cleanup.
 */
export async function reportLostSave(
  noteId: string,
  result: SaveResult,
  trigger: LostSaveTrigger,
): Promise<void> {
  const verdict = lostSaveVerdict(result);
  if (!verdict || reported.has(result)) return;
  reported.add(result);

  try {
    const t = createTranslate(useI18nStore.getState().bundle);
    const title = readCachedNoteTitle(noteId)?.trim() || t('Notes', 'Untitled');
    toast.warning(t('Notes', verdict === 'incomplete' ? 'SaveLostIncompleteTitle' : 'SaveLostTitle', { 0: title }), {
      description: t('Notes', DESCRIPTIONS[verdict]),
      // Keep the warning visible until dismissed.
      durationMs: 0,
    });
  } catch {
    // A toast failure must not prevent host reporting or caller cleanup.
  }

  const abort = new AbortController();
  const waitMs = Math.max(0, Math.min(EXIT_REPORT_WAIT_MS, shutdownTimeLeftMs() - EXIT_READY_MARGIN_MS));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abort.abort();
      reject(new Error(`no answer within ${String(waitMs)}ms`));
    }, waitMs);
  });
  try {
    await Promise.race([
      apiSend('/app/save-lost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Send the identifier only; titles may contain private content.
        body: JSON.stringify({ noteId, verdict, trigger }),
        signal: abort.signal,
      }),
      expiry,
    ]);
  } catch (error) {
    // Log refusal by an incompatible host, or a request past its bound, for diagnosis.
    console.error('[notes] could not tell the host about a lost save', error);
  } finally {
    clearTimeout(timer);
  }
}
