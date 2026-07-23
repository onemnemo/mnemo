import { describe, expect, it } from 'vitest';
import type { SaveState } from '../authority/authority';
import { describeSaveState } from './save-state-view';

describe('describeSaveState', () => {
  it('says nothing for a note that has only loaded, so opening never flashes "Saved"', () => {
    expect(describeSaveState('loading')).toBeNull();
    expect(describeSaveState('loaded')).toBeNull();
  });

  it('shows the quiet working states', () => {
    expect(describeSaveState('dirty')).toMatchObject({ labelKey: 'SaveStateUnsaved', tone: 'quiet' });
    expect(describeSaveState('saving')).toMatchObject({ labelKey: 'SaveStateSaving', tone: 'quiet' });
    expect(describeSaveState('saved')).toMatchObject({ labelKey: 'SaveStateSaved', tone: 'quiet' });
  });

  it('renders retrying and recovered honestly even though the authority never sets them today', () => {
    // KNOWN GAP: the autosave policy drives dirty/saving/saved/save_failed/version_conflict;
    // retrying and recovered are reserved vocabulary. The indicator must still paint
    // them correctly if the policy layer ever produces them.
    expect(describeSaveState('retrying')).toMatchObject({ labelKey: 'SaveStateRetrying', tone: 'warning' });
    expect(describeSaveState('recovered')).toMatchObject({ labelKey: 'SaveStateRecovered', tone: 'quiet' });
  });

  it('marks a failed save as danger, retried automatically, with no reload button', () => {
    const view = describeSaveState('save_failed');
    expect(view).toMatchObject({ labelKey: 'SaveStateFailed', tone: 'danger', showReload: false });
    expect(view?.descriptionKey).toBe('SaveStateFailedDescription');
  });

  it('is the only state that offers a reload, because a conflict must not be overwritten', () => {
    const view = describeSaveState('version_conflict');
    expect(view).toMatchObject({ labelKey: 'SaveStateConflict', tone: 'danger', showReload: true });
    expect(view?.descriptionKey).toBe('SaveStateConflictDescription');
  });

  it('shows nothing for a quarantined document, which never mounts an editor', () => {
    expect(describeSaveState('invalid_document')).toBeNull();
  });

  it('handles every declared save state without falling through', () => {
    const all: SaveState[] = [
      'loading', 'loaded', 'dirty', 'saving', 'saved',
      'retrying', 'save_failed', 'version_conflict', 'recovered', 'invalid_document',
    ];
    // A non-null view must always carry a label; a null view is a deliberate silence.
    for (const state of all) {
      const view = describeSaveState(state);
      if (view) expect(view.labelKey.length).toBeGreaterThan(0);
    }
  });
});
