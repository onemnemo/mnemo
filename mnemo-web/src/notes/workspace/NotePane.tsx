import { useEffect, useMemo, useRef, useState } from 'react';

import { AppIcon } from '@/components/icon/AppIcon';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n/useT';
import type { NoteFolderDto, NoteSummaryDto } from '@/api/types';

import { useNoteQuery } from '../api';
import { createNoteAssetServices } from '../assets/services';
import { parseBlocks } from '../model/wire';
import { buildNoteEditState } from '../edit/build-edit-state';
import { NoteSurface } from './NoteSurface';

/**
 * The editor half of the workspace: fetch one note and keep its four states
 * distinguishable, loading, failed, invalid (quarantine) and empty, each on its
 * own surface, with the editor for a rendered note. A note written before the
 * block editor existed keeps its plain content rather than reading as empty.
 *
 * Perceived loading is a stable skeleton bar, not a spinner that resolves into a
 * different layout; the toggle to reopen a collapsed sidebar is always present.
 */
export function NotePane({
  noteId,
  notes,
  folders,
  sidebarOpen,
  onToggleSidebar,
}: {
  noteId: string;
  notes: NoteSummaryDto[];
  folders: NoteFolderDto[];
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  const t = useT();
  const nt = (key: string, params?: Record<string, string | number>) => t('Notes', key, params);
  const query = useNoteQuery(noteId);
  const note = query.data;

  const [reloadNonce, setReloadNonce] = useState(0);

  const latest = useRef(note);
  latest.current = note;

  // Keyed on identity and a deliberate reload, reading current bytes through a
  // ref, so a refetch after autosave never rebuilds the document under the caret.
  const loaded = useMemo(() => {
    const current = latest.current;
    if (!current) return null;
    const blocks = parseBlocks(current.blocks ?? []);
    const assets = createNoteAssetServices();
    return {
      blocks,
      assets,
      edit: blocks.length > 0 ? buildNoteEditState(blocks, assets.services) : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id, reloadNonce]);

  useEffect(() => {
    const assets = loaded?.assets;
    return () => assets?.release();
  }, [loaded]);

  const bar = <PaneTopBar sidebarOpen={sidebarOpen} onToggleSidebar={onToggleSidebar} />;

  if (query.isPending) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {bar}
        <div className="mx-auto w-full max-w-[760px] px-10 pt-9">
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
        {bar}
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

  // Empty: no blocks. A legacy note keeps its plain content.
  if (!loaded || loaded.blocks.length === 0) {
    const legacy = note.content.trim();
    return (
      <div className="flex h-full min-h-0 flex-col">
        {bar}
        <div className="mx-auto w-full max-w-[760px] px-10 pt-9">
          <h1 className="text-heading-2 font-semibold text-text-primary">{title}</h1>
          {legacy ? (
            <p className="mt-6 whitespace-pre-wrap text-body-medium text-text-primary">{note.content}</p>
          ) : (
            <EmptyState className="mt-10" icon="common/file-text" title={nt('EmptyNoteTitle')} description={nt('EmptyNoteDescription')} />
          )}
        </div>
      </div>
    );
  }

  // Invalid: the schema cannot represent this note. Held intact, never opened as
  // an editable blank that autosave would write over the real content.
  if (loaded.edit && !loaded.edit.ok) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {bar}
        <div className="mx-auto w-full max-w-[760px] px-10 pt-9">
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
      notes={notes}
      folders={folders}
      sidebarOpen={sidebarOpen}
      onToggleSidebar={onToggleSidebar}
    />
  ) : null;
}

function PaneTopBar({ sidebarOpen, onToggleSidebar }: { sidebarOpen: boolean; onToggleSidebar: () => void }) {
  const t = useT();
  if (sidebarOpen) return <div className="h-11 shrink-0 border-b border-divider-subtle" />;
  return (
    <div className="flex h-11 shrink-0 items-center border-b border-divider-subtle px-3">
      <button
        type="button"
        aria-label={t('Notes', 'ExpandSidebar')}
        title={t('Notes', 'ExpandSidebar')}
        onClick={onToggleSidebar}
        className="grid size-[26px] place-items-center rounded-md text-text-secondary hover:bg-[var(--widget-background-hover)] hover:text-text-primary"
      >
        <AppIcon name="common/layout-sidebar" size={15} />
      </button>
    </div>
  );
}
