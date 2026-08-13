import { describe, expect, it } from 'vitest';
import type { SaveState } from '../authority/authority';
import { describeSaveState } from './save-state-view';

const ALL: SaveState[] = [
  'loading', 'loaded', 'dirty', 'saving', 'saved',
  'retrying', 'save_failed', 'version_conflict', 'recovered', 'invalid_document',
];

/** The steady editing cycle: the states the user only needs narrated when they own the writing. */
const CYCLE: SaveState[] = ['dirty', 'saving', 'saved'];

const off = { autosave: false };
const on = { autosave: true };

describe('describeSaveState', () => {
  it('says nothing for a note that has only loaded, so opening never flashes "Saved"', () => {
    expect(describeSaveState('loading', off)).toBeNull();
    expect(describeSaveState('loaded', off)).toBeNull();
  });

  it('shows the quiet working states when the user owns the saving', () => {
    expect(describeSaveState('dirty', off)).toMatchObject({ labelKey: 'SaveStateUnsaved', tone: 'quiet' });
    expect(describeSaveState('saving', off)).toMatchObject({ labelKey: 'SaveStateSaving', tone: 'quiet' });
    expect(describeSaveState('saved', off)).toMatchObject({ labelKey: 'SaveStateSaved', tone: 'quiet' });
  });

  it('says nothing about the editing cycle while autosave owns it', () => {
    for (const state of CYCLE) {
      expect(describeSaveState(state, on)).toBeNull();
    }
  });

  it('still reports trouble under autosave, since a silent failure is the thing to avoid', () => {
    // The whole point of the gate above is noise, not secrecy. A state where the
    // text on screen is not the text on disk is never suppressed.
    for (const state of ['retrying', 'save_failed', 'version_conflict'] as SaveState[]) {
      expect(describeSaveState(state, on)).not.toBeNull();
      expect(describeSaveState(state, off)).not.toBeNull();
    }
  });

  it('renders retrying and recovered honestly even though the authority never sets them today', () => {
    // KNOWN GAP: the autosave policy drives dirty/saving/saved/save_failed/version_conflict;
    // retrying and recovered are reserved vocabulary. The indicator must still paint
    // them correctly if the policy layer ever produces them.
    expect(describeSaveState('retrying', off)).toMatchObject({ labelKey: 'SaveStateRetrying', tone: 'warning' });
    expect(describeSaveState('recovered', off)).toMatchObject({ labelKey: 'SaveStateRecovered', tone: 'quiet' });
  });

  it('takes a failure back off the screen with recovered, whichever way saving happens', () => {
    // Quiet in tone but not part of the editing cycle: it is what resolves a
    // failure the reader was already shown, so hiding it would leave the last
    // word on screen as an error that no longer applies.
    expect(describeSaveState('recovered', on)).toMatchObject({ labelKey: 'SaveStateRecovered' });
  });

  it('marks a failed save as danger, with no reload button', () => {
    const view = describeSaveState('save_failed', on);
    expect(view).toMatchObject({ labelKey: 'SaveStateFailed', tone: 'danger', showReload: false });
  });

  it('promises an automatic retry only where one is actually waiting', () => {
    // The stored wording is "saving will be retried when you keep typing", which
    // is autosave's behaviour. With autosave off nothing is armed, so the offer
    // has to be a button the user presses, not a sentence that is untrue.
    expect(describeSaveState('save_failed', on)?.descriptionKey).toBe('SaveStateFailedDescription');
    expect(describeSaveState('save_failed', on)?.showRetrySave).toBe(false);

    expect(describeSaveState('save_failed', off)?.descriptionKey).toBeUndefined();
    expect(describeSaveState('save_failed', off)?.showRetrySave).toBe(true);
  });

  it('never says a note is saved once a save has failed', () => {
    for (const options of [on, off]) {
      expect(describeSaveState('save_failed', options)?.labelKey).toBe('SaveStateFailed');
      expect(describeSaveState('version_conflict', options)?.labelKey).toBe('SaveStateConflict');
    }
  });

  it('is the only state that offers a reload, because a conflict must not be overwritten', () => {
    const view = describeSaveState('version_conflict', off);
    expect(view).toMatchObject({ labelKey: 'SaveStateConflict', tone: 'danger', showReload: true });
    expect(view?.descriptionKey).toBe('SaveStateConflictDescription');
    // A conflict is the one answer that must not simply be written again, so the
    // save button is withheld even though autosave is off.
    expect(view?.showRetrySave).toBe(false);
  });

  it('shows nothing for a quarantined document, which never mounts an editor', () => {
    expect(describeSaveState('invalid_document', off)).toBeNull();
    expect(describeSaveState('invalid_document', on)).toBeNull();
  });

  it('handles every declared save state without falling through', () => {
    // A non-null view must always carry a label; a null view is a deliberate silence.
    for (const state of ALL) {
      for (const options of [on, off]) {
        const view = describeSaveState(state, options);
        if (view) expect(view.labelKey.length).toBeGreaterThan(0);
      }
    }
  });
});
