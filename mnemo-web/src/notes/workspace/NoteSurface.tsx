import 'katex/dist/katex.min.css';
import '../page/notes-editor.css';

import { useMemo, useRef, useState } from 'react';
import { Selection, type EditorState } from 'prosemirror-state';

import { useT } from '@/i18n/useT';
import { cn } from '@/lib/utils';
import { formatRelative } from '@/lib/relative-date';
import { useSettingValue } from '@/settings/store';
import type { NoteSummaryDto } from '@/api/types';

import { useNoteContentCommitter, useUpdateNoteMetadata } from '../api';
import { metadataUpdateOf } from '../note-metadata';
import { hasCover } from './covers';
import { AddHeaderChrome, COVER_BANNER_HEIGHT, CoverBanner, NoteIcon } from './NoteHeaderChrome';
import { NoteTags } from './NoteTags';
import { NoteTitle } from './NoteTitle';
import { PasteProgressOverlay } from '../clipboard/PasteProgressOverlay';
import type { DocumentMapper } from '../editor/mapper/document';
import type { BlockRegistry } from '../editor/registry/build';
import type { EditorServices } from '../editor/registry/types';
import { documentWordCount } from '../editor/projection/word-count';
import { useNoteSession } from '../edit/useNoteSession';
import { useSpellcheck } from '../edit/useSpellcheck';
import { BlockGutter } from '../editor/chrome/BlockGutter';
import { CalloutIconPicker } from '../editor/chrome/CalloutIconPicker';
import { EditorContextMenu } from '../editor/chrome/EditorContextMenu';
import { FindReplaceOverlay } from '../find/FindReplaceOverlay';
import { createPersist } from '../save/persist';
import { useSaveShortcut } from '../save/useSaveShortcut';
import { BlockSelectionAnnouncer } from '../selection/BlockSelectionAnnouncer';
import { BlockSelectionOverlay } from '../selection/BlockSelectionOverlay';
import { SelectionBands } from '../selection/SelectionBands';
import { PaneActions } from './PaneActions';
import { SaveStateIndicator } from './SaveStateIndicator';
import { useEditorMeasure } from './useEditorMeasure';
import { IndexChip } from './IndexChip';
import { NodeViewPortals } from '../editor/view/NodeViewPortal';
import { createPortalRegistry } from '../editor/view/portal-registry';

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
}) {
  const t = useT();
  const nt = (key: string, params?: Record<string, string | number>) => t('Notes', key, params);
  const commit = useNoteContentCommitter();
  const updateNote = useUpdateNoteMetadata();
  const paneRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Metadata edits are a full replace; route every one through the carry so a
  // cover change never blanks the tags, or an emoji change the folder.
  const patch = (next: Partial<Pick<NoteSummaryDto, 'title' | 'emoji' | 'cover' | 'coverCrop' | 'tags'>>) =>
    void updateNote.mutateAsync(metadataUpdateOf(note, next));

  // The banner's own measured width, read fresh whenever the cover picker opens the editor.
  // Zero until a cover exists to measure, which is exactly the first-cover case: nothing has
  // ever reported a width, so the band the editor should open framed against is read straight
  // off the scroller instead, since the banner is `w-full` inside it and would measure the
  // same number once it existed. Both the header affordance and the kebab read this same
  // closure, so neither entry point can disagree about the band. 0 still means genuinely
  // unmeasurable (the scroller itself has not mounted), which the picker falls back from.
  const [bannerWidth, setBannerWidth] = useState(0);
  const measureBandAspect = () => {
    const width = bannerWidth > 0 ? bannerWidth : (scrollRef.current?.clientWidth ?? 0);
    return width > 0 ? width / COVER_BANNER_HEIGHT : 0;
  };

  const persist = useMemo(
    () => createPersist({ fromDoc: (doc) => mapper.fromDoc(doc), commit }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [noteId],
  );

  // One registry per surface, so the React chrome a NodeView mounts reconciles
  // inside this tree rather than in a second root nested in ProseMirror's DOM.
  const portals = useMemo(() => createPortalRegistry(), []);
  const viewServices = { ...services, portals };

  const { ref, saveState, view, save } = useNoteSession({
    noteId,
    sid,
    ver,
    state,
    registry,
    persist,
    services: viewServices,
  });

  // Read reactively, so turning autosave off mid-note starts reporting the save
  // state on the change already sitting unsaved rather than on the next one.
  const autosave = useSettingValue('Editor.AutoSave', true);
  useSaveShortcut(save);

  // Recomputed off the live document each time a save settles (and on load),
  // which matches the desktop: cheap, canonical, and never per keystroke.
  const wordCount = useMemo(
    () => documentWordCount(view ? view.state.doc : state.doc, registry),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, registry, saveState],
  );

  const coverSet = hasCover(note.cover);
  const { maxWidth } = useEditorMeasure();
  const { spellCheck, lang } = useSpellcheck();

  return (
    <div ref={paneRef} className="group/pane relative flex h-full min-h-0 flex-col">
      {/* The note's chrome, pinned to the pane rather than a bar over it: the
          breadcrumb now lives in the shared topbar. The row is anchored to the
          right with the actions last, so the save label changing length moves
          its own left edge into empty chrome and nothing else. */}
      <div className="absolute right-3 top-2.5 z-30 flex items-center gap-2">
        <SaveStateIndicator state={saveState} autosave={autosave} onReload={onReload} onSave={save} />
        <PaneActions note={note} measureBandAspect={measureBandAspect} />
      </div>
      {/* A stable gutter so the centered column does not jump left the first time
          the note grows tall enough to want a scrollbar (and back when it shrinks). */}
      <div ref={scrollRef} className="scroll-thin relative min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <CoverBanner token={note.cover} crop={note.coverCrop} onBandWidth={setBannerWidth} />
        {/* No bottom padding: the space under the document belongs to the
            editable root now, so a press in it reaches the view and appends a
            block instead of landing on the pane. */}
        <div className={cn('mx-auto w-full px-14', coverSet ? 'pt-0' : 'pt-10')} style={{ maxWidth }}>
          {note.emoji ? (
            // The icon is positioned so it lifts over the cover's lower edge, the
            // way a page icon reads on the surfaces this is modelled on. The cover
            // is a positioned element and would otherwise paint over it.
            <div className={cn('relative z-10', coverSet ? '-mt-[46px]' : 'mt-2')}>
              <NoteIcon value={note.emoji} />
            </div>
          ) : null}
          <AddHeaderChrome
            cover={note.cover}
            coverCrop={note.coverCrop}
            hasIcon={Boolean(note.emoji)}
            onCover={(next) => patch(next)}
            onIcon={(emoji) => patch({ emoji })}
            measureBandAspect={measureBandAspect}
          />
          <NoteTitle
            title={note.title}
            placeholder={nt('Untitled')}
            onCommit={(next) => patch({ title: next })}
            onEnter={() => {
              if (!view) return;
              view.dispatch(view.state.tr.setSelection(Selection.atStart(view.state.doc)));
              view.focus();
            }}
          />
          <NoteTags tags={note.tags} onChange={(tags) => patch({ tags })} />
          <div className="mb-6 mt-2 text-[0.8125rem] text-ink-3">
            {nt('WordCountFormat', { 0: wordCount.toLocaleString() })}
            {' · '}
            {nt('EditedRelativeFormat', { 0: formatRelative(note.modifiedAt, Date.now(), t) })}
          </div>
          {/* Rendered whether or not the view exists yet: this owns the element
              ProseMirror mounts into, so it must never come and go under it. */}
          <EditorContextMenu view={view} registry={registry} services={viewServices}>
            <div ref={ref} className="notes-doc" lang={lang} spellCheck={spellCheck} />
          </EditorContextMenu>
        </div>
      </div>
      {view ? <IndexChip view={view} registry={registry} scrollRef={scrollRef} /> : null}
      {view ? (
        <BlockSelectionOverlay view={view} registry={registry} paneRef={paneRef} scrollRef={scrollRef} />
      ) : null}
      {view ? <SelectionBands view={view} registry={registry} scrollRef={scrollRef} /> : null}
      {view ? <BlockSelectionAnnouncer view={view} /> : null}
      {view ? <BlockGutter view={view} registry={registry} /> : null}
      {view ? <CalloutIconPicker view={view} registry={registry} /> : null}
      {view ? <FindReplaceOverlay view={view} registry={registry} /> : null}
      <NodeViewPortals registry={portals} />
      <PasteProgressOverlay />
    </div>
  );
}
