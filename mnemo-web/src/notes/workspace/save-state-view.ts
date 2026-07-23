/**
 * What the breadcrumb says about where your work stands, as a pure decision.
 *
 * The one rule that matters here is that a note nobody has touched says nothing:
 * `loading` and `loaded` return null, so opening a note can never flash "Saved"
 * for a save that did not happen. Everything loud is loud for a reason the user
 * has to act on, everything quiet is quiet because a note saving normally is not
 * news. Keeping this a pure function of the state, separate from the pill that
 * paints it, is what lets the honesty be tested without a DOM.
 */

import type { SaveState } from '../authority/authority';

export type SaveTone = 'quiet' | 'warning' | 'danger';

export interface SaveStateView {
  /** i18n key in the `Notes` namespace for the short status word. */
  readonly labelKey: string;
  /** Longer explanation, shown as a tooltip; present only for the loud states. */
  readonly descriptionKey?: string;
  readonly tone: SaveTone;
  /** Whether the user must choose to reload: only a version conflict, which
   *  autosave has correctly stopped retrying so it cannot overwrite. */
  readonly showReload: boolean;
}

/**
 * Maps a save state to what the indicator shows, or null for the states that
 * show nothing.
 *
 * `invalid_document` returns null on purpose: a note the schema cannot represent
 * never mounts an editor, it is held on the quarantine surface with its bytes
 * intact, so the breadcrumb over an editor is never asked to render it.
 */
export function describeSaveState(state: SaveState): SaveStateView | null {
  switch (state) {
    case 'loading':
    case 'loaded':
    case 'invalid_document':
      return null;
    case 'dirty':
      return { labelKey: 'SaveStateUnsaved', tone: 'quiet', showReload: false };
    case 'saving':
      return { labelKey: 'SaveStateSaving', tone: 'quiet', showReload: false };
    case 'saved':
      return { labelKey: 'SaveStateSaved', tone: 'quiet', showReload: false };
    case 'recovered':
      // A save that had failed has since landed; the content is safe, so this
      // reassures rather than warns.
      return { labelKey: 'SaveStateRecovered', tone: 'quiet', showReload: false };
    case 'retrying':
      return { labelKey: 'SaveStateRetrying', tone: 'warning', showReload: false };
    case 'save_failed':
      return {
        labelKey: 'SaveStateFailed',
        descriptionKey: 'SaveStateFailedDescription',
        tone: 'danger',
        showReload: false,
      };
    case 'version_conflict':
      return {
        labelKey: 'SaveStateConflict',
        descriptionKey: 'SaveStateConflictDescription',
        tone: 'danger',
        showReload: true,
      };
  }
}
