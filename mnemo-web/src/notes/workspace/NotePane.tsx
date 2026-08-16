import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n/useT';

import { useNoteQuery } from '../api';
import { createNoteAssetServices } from '../assets/services';
import { parseBlocks } from '../model/wire';
import { buildNoteEditState } from '../edit/build-edit-state';
import { NoteSurface } from './NoteSurface';
import { useEditorMeasure } from './useEditorMeasure';

/**
 * The editor half of the workspace: fetch one note and keep its four states
 * distinguishable, loading, failed, invalid (quarantine) and empty, each on its
 * own surface, with the editor for a rendered note. A note written before the
 * block editor existed keeps its plain content rather than reading as empty.
 *
 * Perceived loading is a stable skeleton bar, not a spinner that resolves into a
 * different layout, and every placeholder shares the loaded document's measure so
 * the column never jumps width as it resolves.
 */
export function NotePane({ noteId }: { noteId: string }) {
  const t = useT();
  const nt = (key: string, params?: Record<string, string | number>) => t('Notes', key, params);
  const query = useNoteQuery(noteId);
  const note = query.data;
  const { maxWidth } = useEditorMeasure();

  const [reloadNonce, setReloadNonce] = useState(0);

  const latest = useRef(note);
  latest.current = note;

  // Keyed on identity and a deliberate reload, reading current bytes through a
  // ref, so a refetch after autosave never rebuilds the document under the caret.
  const loaded = useMemo(() => {
    const current = latest.current;
    if (!current) return null;
    const blocks = parseBlocks(current.blocks ?? []);
    const assets = createNoteAssetServices(current.id);
    // A note with no blocks but plain legacy content is shown read-only. Anything
    // else, a brand-new note included, opens the editor: `buildNoteEditState`
    // seeds a single empty block, so the never-fully-empty invariant holds and the
    // caret has somewhere to land instead of the note being stuck on an empty card.
    const legacyOnly = blocks.length === 0 && current.content.trim().length > 0;
    return {
      blocks,
      assets,
      legacyOnly,
      edit: legacyOnly ? null : buildNoteEditState(blocks, assets.services),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id, reloadNonce]);

  useEffect(() => {
    const assets = loaded?.assets;
    return () => assets?.release();
  }, [loaded]);

  if (query.isPending) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="mx-auto w-full px-14 pt-9" style={{ maxWidth }}>
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="mt-4 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-11/12" />
          <Skeleton className="mt-2 h-4 w-4/5" />
        </div>
      </div>
    );
  }

  if (query.isError || !note) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <EmptyState
          className="mt-12"
          icon="common/triangle-alert"
          title={nt('LoadFailedTitle')}
          description={nt('LoadFailedDescription')}
          action={
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
              {nt('Retry')}
            </Button>
          }
        />
      </div>
    );
  }

  const title = note.title.trim() || nt('Untitled');

  // Legacy: no blocks, but plain content written before the block editor. Shown
  // read-only rather than opened as an editable blank that autosave would write
  // over. A note with no blocks and no legacy content is not shown here; it opens
  // the editor below, seeded with one empty block.
  if (!loaded || loaded.legacyOnly) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="mx-auto w-full px-14 pt-9" style={{ maxWidth }}>
          <h1 className="text-heading-2 font-semibold text-text-primary">{title}</h1>
          <p className="mt-6 whitespace-pre-wrap text-body-medium text-text-primary">{note.content}</p>
        </div>
      </div>
    );
  }

  // Invalid: the schema cannot represent this note. Held intact, never opened as
  // an editable blank that autosave would write over the real content.
  if (loaded.edit && !loaded.edit.ok) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="mx-auto w-full px-14 pt-9" style={{ maxWidth }}>
          <h1 className="text-heading-2 font-semibold text-text-primary">{title}</h1>
          <EmptyState
            className="mt-10"
            icon="common/square-rounded-x"
            title={nt('QuarantineTitle')}
            description={nt('QuarantineDescription')}
          />
        </div>
      </div>
    );
  }

  const reload = () => {
    void query.refetch().then(() => setReloadNonce((previous) => previous + 1));
  };

  return loaded.edit?.ok ? (
    <NoteSurface
      // The nonce is in the key so a reload is a full remount: the session owns
      // its document, and there is no way to hand it a different one.
      key={`${note.id}:${String(reloadNonce)}`}
      noteId={note.id}
      sid={note.sid}
      ver={note.ver}
      state={loaded.edit.state}
      registry={loaded.edit.registry}
      mapper={loaded.edit.mapper}
      services={loaded.assets.services}
      onReload={reload}
      note={note}
    />
  ) : null;
}
