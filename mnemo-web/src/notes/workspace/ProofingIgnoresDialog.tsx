import { useMemo, useState } from 'react';

import { AppIcon } from '@/components/icon/AppIcon';
import { ListState } from '@/components/ui/list-state';
import { Modal } from '@/components/ui/modal';
import { useT } from '@/i18n/useT';
import { useAddNoteIgnore, useProofingNoteIgnores, useRemoveNoteIgnore } from '@/notes/proofing/status';
import { toast } from '@/stores/toast';

const NO_WORDS: readonly string[] = [];

/**
 * The words this note accepts that the dictionary does not.
 *
 * "Ignore in this note" is one click on a card that closes behind it, so this
 * list is where an accidental one is seen and taken back. It is a per-note
 * list, so it hangs off the note's own menu rather than off settings, where
 * there is no note to be looking at.
 */
export function ProofingIgnoresDialog({ noteId, onClose }: { noteId: string; onClose: () => void }) {
  const t = useT();
  const nt = (key: string, params?: Record<string, string | number>) => t('Notes', key, params);
  const { data, isPending, isError, refetch } = useProofingNoteIgnores(noteId);
  const [busy, setBusy] = useState<readonly string[]>([]);

  const words = data?.words ?? NO_WORDS;
  const sorted = useMemo(() => [...words].sort((a, b) => a.localeCompare(b)), [words]);

  const warn = () => toast.warning(t('Common', 'Error'));
  const restoreIgnore = useAddNoteIgnore(noteId, { onError: warn });
  const removeIgnore = useRemoveNoteIgnore(noteId, {
    onSuccess: (_next, word) => {
      toast.info(nt('SpellingIgnoreLiftedFormat', { 0: word }), {
        primary: { label: t('Common', 'Undo'), onClick: () => restoreIgnore.mutate(word) },
      });
    },
    onError: warn,
    onSettled: (word) => setBusy((current) => current.filter((entry) => entry !== word)),
  });

  function remove(word: string) {
    setBusy((current) => [...current, word]);
    removeIgnore.mutate(word);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={nt('SpellingIgnoredTitle')}
      subtitle={nt('SpellingIgnoredSubtitle')}
      closeLabel={t('Common', 'Close')}
      width={460}
    >
      <div className="scroll-thin min-h-0 w-full flex-1 overflow-y-auto px-5 pb-5 pt-1">
        {isPending ? (
          <ListState message={nt('SpellingIgnoredLoading')} />
        ) : isError ? (
          <ListState
            message={nt('SpellingIgnoredFailed')}
            action={{ label: t('Common', 'Retry'), onClick: () => void refetch() }}
          />
        ) : sorted.length === 0 ? (
          <ListState message={nt('SpellingIgnoredEmpty')} />
        ) : (
          <div className="[&>*+*]:border-t [&>*+*]:border-line-soft">
            {sorted.map((word) => (
              <div key={word} className="flex items-center gap-2 py-1.5">
                <p className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{word}</p>
                <button
                  type="button"
                  disabled={busy.includes(word)}
                  onClick={() => remove(word)}
                  aria-label={nt('SpellingIgnoreLiftFormat', { 0: word })}
                  className="grid size-7 shrink-0 place-items-center rounded-md text-ink-3 transition-colors hover:bg-danger-wash hover:text-danger disabled:pointer-events-none disabled:opacity-45"
                >
                  <AppIcon name="trash-2" size={15} strokeWidth={1.7} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
