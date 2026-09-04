import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { navigate } from '@/app/router';
import { MenuCheckItem, MenuItem, MenuSeparator, MenuSubMenu } from '@/components/ui/menu';
import { useT } from '@/i18n/useT';

import type { ProofingClient } from '../proofing/client';
import { languageNameLookup } from '../proofing/language-names';
import {
  PROOFING_STATUS_KEY,
  proofingClient,
  useInvalidateProofing,
  useProofingStatus,
} from '../proofing/status';
import type { NoteProofingChoice, ProofingStatus } from '../proofing/types';
import {
  activeLanguagesLabel,
  installedLanguages,
  languageLabel,
  languageSummary,
  noteLanguageChoice,
  noteLanguageIds,
  noteLanguageState,
} from './note-language-menu';

/**
 * Which languages this note is checked in, inside the note's own menu.
 *
 * A property of the document, sitting with its width: the choice changes every
 * paragraph, so it does not belong one click away from a paragraph.
 *
 * "Use my defaults" is a state of its own rather than the defaults spelled out.
 * A note pinned to one language stays there when a second is switched on
 * globally; a note on the defaults follows. Losing that distinction would turn
 * the first visit to this menu into a silent pin.
 */
export function NoteLanguageMenu({
  noteId,
  onManageIgnores,
  client = proofingClient,
}: {
  noteId: string;
  /** Opens the note's ignore list. Owned by the pane, because a menu unmounts its own contents. */
  onManageIgnores: () => void;
  /** Injected by tests; the app takes the default. */
  client?: Pick<ProofingClient, 'setNoteLanguages'>;
}) {
  const t = useT();
  const nt = (key: string) => t('Notes', key);
  const named = languageNameLookup(t);
  const { data: status } = useProofingStatus(noteId);
  const invalidate = useInvalidateProofing();
  const queryClient = useQueryClient();

  // The language rows stay open across a tick, so a second one lands while the
  // first is still on the wire. The status cannot answer for it: it only
  // catches up once that write has returned and the refetch behind it has
  // landed, so a tick composed against the status would compose against the
  // choice it replaced, and ticking two languages would write one of them away.
  // The menu therefore carries the choice itself while anything is
  // outstanding, and lets the stored answer take back over once nothing is.
  const [choice, setChoice] = useState<NoteProofingChoice | null>(null);
  const outstanding = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const state = noteLanguageState(status, choice);
  const installed = installedLanguages(state);
  const ticked = noteLanguageIds(state);
  const mode = state.choice.mode;

  const write = (next: NoteProofingChoice) => {
    setChoice(next);
    outstanding.current += 1;
    // Serialised rather than sent side by side: the second write composes on
    // the first, so letting them race would leave the host free to apply them
    // in the other order and store a choice nobody asked for.
    queue.current = queue.current.then(() =>
      client
        .setNoteLanguages(noteId, next)
        // The host's own answer, put where the menu reads from, so the stored
        // choice is already current by the time the menu stops holding its own.
        .then((note) => {
          queryClient.setQueryData<ProofingStatus>([...PROOFING_STATUS_KEY, noteId], (current) =>
            current ? { ...current, note } : current,
          );
        })
        // A refused write, the note limit among the reasons, leaves the stored
        // choice alone. Dropping the menu's own and refetching is what puts it
        // back on the truth instead of on a tick that never landed.
        .catch(() => {})
        .finally(() => {
          outstanding.current -= 1;
          if (outstanding.current === 0) setChoice(null);
          invalidate();
        }),
    );
  };

  return (
    <MenuSubMenu
      label={nt('SpellingLanguage')}
      icon="common/spell-check"
      hint={
        status
          ? languageSummary(state, { off: nt('SpellingOff'), none: nt('SpellingNoneInstalled') }, named)
          : undefined
      }
    >
      <MenuCheckItem
        checked={mode === 'default'}
        description={activeLanguagesLabel(state, nt('SpellingNoLanguagesOn'), named)}
        onSelect={() => write({ mode: 'default' })}
      >
        {nt('SpellingUseDefaults')}
      </MenuCheckItem>
      <MenuSeparator />
      {installed.map((language) => (
        <MenuCheckItem
          key={language.id}
          checked={ticked.includes(language.id)}
          closeOnSelect={false}
          onSelect={() => write(noteLanguageChoice(state, language.id))}
        >
          {languageLabel(language.id, state.catalogue, named)}
        </MenuCheckItem>
      ))}
      <MenuSeparator />
      <MenuCheckItem
        checked={mode === 'off'}
        onSelect={() => write({ mode: mode === 'off' ? 'default' : 'off' })}
      >
        {nt('SpellingSkipNote')}
      </MenuCheckItem>
      <MenuSeparator />
      <MenuItem onSelect={onManageIgnores}>{nt('SpellingManageIgnored')}</MenuItem>
      <MenuItem onSelect={() => navigate('settings', 'Proofing')}>{nt('SpellingSettings')}</MenuItem>
    </MenuSubMenu>
  );
}
