import 'katex/dist/katex.min.css';
import '../page/notes-editor.css';

import { useMemo, useRef } from 'react';
import type { EditorState } from 'prosemirror-state';

import { useT } from '@/i18n/useT';
import { cn } from '@/lib/utils';
import { formatRelative } from '@/lib/relative-date';
import type { NoteFolderDto, NoteSummaryDto } from '@/api/types';

import { useNoteContentCommitter, useUpdateNoteMetadata } from '../api';
import { metadataUpdateOf } from '../note-metadata';
import { coverCss } from './covers';
import { AddHeaderChrome, CoverBanner, NoteIcon } from './NoteHeaderChrome';
import { NoteTags } from './NoteTags';
import { PasteProgressOverlay } from '../clipboard/PasteProgressOverlay';
import type { DocumentMapper } from '../editor/mapper/document';
import type { BlockRegistry } from '../editor/registry/build';
import type { EditorServices } from '../editor/registry/types';
import { documentWordCount } from '../editor/projection/word-count';
import { useNoteSession } from '../edit/useNoteSession';
import { BlockGutter } from '../editor/chrome/BlockGutter';
import { FindReplaceOverlay } from '../find/FindReplaceOverlay';
import { createPersist } from '../save/persist';
import { BlockSelectionAnnouncer } from '../selection/BlockSelectionAnnouncer';
import { BlockSelectionOverlay } from '../selection/BlockSelectionOverlay';
import { BreadcrumbBar } from './BreadcrumbBar';
import { IndexChip } from './IndexChip';

/**
 * One note's whole editing surface: the breadcrumb over it, the document itself,
 * the word count and the floating index, all sharing the one live view and save
 * state the session owns. Splitting the chrome out into its own components would
 * have meant lifting the view and the save state up past this boundary on every
 * keystroke; keeping them here is what lets the breadcrumb and the index read the
 * same view the editor is dispatching through.
 *
 * `key` upstream is the note identity, so switching notes destroys and remounts
 * this rather than swapping a document into a surviving view.
 */
export function NoteSurface({
  noteId,
  sid,
  ver,
  state,
  registry,
  mapper,
  services,
  onReload,
  note,
  notes,
  folders,
  sidebarOpen,
  onToggleSidebar,
}: {
  noteId: string;
  sid: string;
  ver: number;
  state: EditorState;
  registry: BlockRegistry;
  mapper: DocumentMapper;
  services?: Partial<EditorServices>;
  onReload: () => void;
  note: NoteSummaryDto;
  notes: NoteSummaryDto[];
  folders: NoteFolderDto[];
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  const t = useT();
  const nt = (key: string, params?: Record<string, string | number>) => t('Notes', key, params);
  const commit = useNoteContentCommitter();
  const updateNote = useUpdateNoteMetadata();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Metadata edits are a full replace; route every one through the carry so a
  // cover change never blanks the tags, or an emoji change the folder.
  const patch = (next: Partial<Pick<NoteSummaryDto, 'emoji' | 'cover' | 'tags'>>) =>
    void updateNote.mutateAsync(metadataUpdateOf(note, next));

  const persist = useMemo(
    () => createPersist({ fromDoc: (doc) => mapper.fromDoc(doc), commit }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [noteId],
  );

  const { ref, saveState, view } = useNoteSession({ noteId, sid, ver, state, registry, persist, services });

  // Recomputed off the live document each time a save settles (and on load),
  // which matches the desktop: cheap, canonical, and never per keystroke.
  const wordCount = useMemo(
    () => documentWordCount(view ? view.state.doc : state.doc, registry),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, registry, saveState],
  );

  const title = note.title.trim() || nt('Untitled');
  const hasCover = coverCss(note.cover) !== null;

  return (
    <div className="group/pane relative flex h-full min-h-0 flex-col">
      <BreadcrumbBar
        note={note}
        notes={notes}
        folders={folders}
        saveState={saveState}
        onReload={onReload}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={onToggleSidebar}
      />
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto">
        <CoverBanner token={note.cover} onChange={(cover) => patch({ cover })} />
        <div className={cn('mx-auto w-full max-w-[760px] px-10 pb-24', hasCover ? 'pt-0' : 'pt-10')}>
          {note.emoji ? (
            // The icon is positioned so it lifts over the cover's lower edge, the
            // way a page icon reads on the surfaces this is modelled on.
            <div className={cn('relative z-10', hasCover ? '-mt-[42px]' : 'mt-2')}>
              <NoteIcon value={note.emoji} onChange={(emoji) => patch({ emoji })} />
            </div>
          ) : null}
          <AddHeaderChrome
            hasCover={hasCover}
            hasIcon={Boolean(note.emoji)}
            onCover={(cover) => patch({ cover })}
            onIcon={(emoji) => patch({ emoji })}
          />
          <h1 className="mt-1 text-[2.5rem] font-bold leading-[1.15] tracking-[-0.02em] text-text-primary">{title}</h1>
          <NoteTags tags={note.tags} onChange={(tags) => patch({ tags })} />
          <div className="mb-6 mt-2 text-body-extra-small text-text-tertiary">
            {nt('WordCountFormat', { 0: wordCount.toLocaleString() })}
            {' · '}
            {nt('EditedRelativeFormat', { 0: formatRelative(note.modifiedAt, Date.now(), t) })}
          </div>
          <div ref={ref} className="notes-doc" />
        </div>
      </div>
      {view ? <IndexChip view={view} registry={registry} scrollRef={scrollRef} /> : null}
      {view ? <BlockSelectionOverlay view={view} registry={registry} scrollRef={scrollRef} /> : null}
      {view ? <BlockSelectionAnnouncer view={view} /> : null}
      {view ? <BlockGutter view={view} registry={registry} /> : null}
      {view ? <FindReplaceOverlay view={view} registry={registry} /> : null}
      <PasteProgressOverlay />
    </div>
  );
}
