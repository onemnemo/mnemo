/**
 * What the note chrome says about where your work stands, as a pure decision.
 *
 * Two rules matter here.
 *
 * A note nobody has touched says nothing: `loading` and `loaded` return null, so
 * opening a note can never flash "Saved" for a save that did not happen.
 *
 * The steady editing cycle (dirty, saving, saved) is only spoken aloud when
 * autosave is off. With autosave on the note writes itself and narrating that is
 * noise; with it off the user is the one deciding when to write, and they cannot
 * decide without being told. Trouble and the end of trouble (retrying, failed,
 * conflict, recovered) are shown either way, because a state where the text on
 * screen is not the text on disk is never a detail to keep quiet about, however
 * the writing was meant to happen.
 *
 * Keeping this a pure function of the state, separate from the chrome that
 * paints it, is what lets the honesty be tested without a DOM.
 */

import type { SaveState } from '../authority/authority';

export type SaveTone = 'quiet' | 'warning' | 'danger';

export interface SaveStateViewOptions {
  /** Whether the editor is writing the note on its own. */
  readonly autosave: boolean;
}

export interface SaveStateView {
  /** i18n key in the `Notes` namespace for the short status word. */
  readonly labelKey: string;
  /** Longer explanation, shown as a tooltip; present only where it is true. */
  readonly descriptionKey?: string;
  readonly tone: SaveTone;
  /** Whether the user must choose to reload: only a version conflict, which
   *  autosave has correctly stopped retrying so it cannot overwrite. */
  readonly showReload: boolean;
  /** Whether to offer a save button: a failure with nothing left that will retry it. */
  readonly showRetrySave: boolean;
}

/**
 * Maps a save state to what the chrome shows, or null for the states that show
 * nothing.
 *
 * `invalid_document` returns null on purpose: a note the schema cannot represent
 * never mounts an editor, it is held on the quarantine surface with its bytes
 * intact, so the chrome over an editor is never asked to render it.
 */
export function describeSaveState(state: SaveState, options: SaveStateViewOptions): SaveStateView | null {
  const { autosave } = options;
  switch (state) {
    case 'loading':
    case 'loaded':
    case 'invalid_document':
      return null;
    case 'dirty':
      return autosave ? null : quiet('SaveStateUnsaved');
    case 'saving':
      return autosave ? null : quiet('SaveStateSaving');
    case 'saved':
      return autosave ? null : quiet('SaveStateSaved');
    case 'recovered':
      // A save that had failed has since landed; the content is safe, so this
      // reassures rather than warns. Shown even under autosave, because it is
      // what takes a failure the user was already told about back off the screen.
      return quiet('SaveStateRecovered');
    case 'retrying':
      return { labelKey: 'SaveStateRetrying', tone: 'warning', showReload: false, showRetrySave: false };
    case 'save_failed':
      return {
        labelKey: 'SaveStateFailed',
        // The stored wording promises a retry on the next keystroke, which is
        // autosave's behaviour and only autosave's. With it off nothing is
        // waiting to try again, so the offer is a button rather than a sentence.
        descriptionKey: autosave ? 'SaveStateFailedDescription' : undefined,
        tone: 'danger',
        showReload: false,
        showRetrySave: !autosave,
      };
    case 'version_conflict':
      return {
        labelKey: 'SaveStateConflict',
        descriptionKey: 'SaveStateConflictDescription',
        tone: 'danger',
        showReload: true,
        showRetrySave: false,
      };
  }
}

function quiet(labelKey: string): SaveStateView {
  return { labelKey, tone: 'quiet', showReload: false, showRetrySave: false };
}
