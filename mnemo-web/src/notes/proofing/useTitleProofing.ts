/**
 * Proofing for the note's title.
 *
 * The title is a plain field outside the document, so the scheduler that walks the
 * editor never sees it. It is asked about here as one segment of its own, once per
 * saved title, and the answer comes back as the issues found, for the surface to name
 * under the heading. The field cannot carry the document's marks: its text is written
 * outside React's render, and a mark inside it would go with the next keystroke. So the
 * flagged words are named rather than underlined.
 *
 * A word accepted or ignored elsewhere changes the answer, so the title is asked about
 * again whenever either word list moves, the way the scheduler is told to forget the
 * segments naming a changed word.
 */

import { useEffect, useMemo, useState } from 'react';

import { isDictionaryLoading, type ProofingClient } from './client';
import { proofingClient, useProofingNoteIgnores, useProofingPersonalWords } from './status';
import type { ProofingIssue } from './types';

/** The one segment id the title is checked under. Not a block sid: no block holds the title. */
export const TITLE_SEGMENT_ID = 'title:0';

export interface UseTitleProofingOptions {
  readonly noteId: string;
  readonly title: string;
  /** The body's marks are live, so the title follows; false clears the answer. */
  readonly active: boolean;
  /** The ready languages the note is checked in, in order. */
  readonly languages: readonly string[];
  /** Injected by tests; the app takes the default. */
  readonly client?: ProofingClient;
}

const NO_ISSUES: readonly ProofingIssue[] = [];

export function useTitleProofing(options: UseTitleProofingOptions): readonly ProofingIssue[] {
  const { noteId, title, active } = options;
  const client = options.client ?? proofingClient;
  const languagesKey = options.languages.join(',');
  const [issues, setIssues] = useState<readonly ProofingIssue[]>(NO_ISSUES);

  // The same queries the editor holds, so watching them costs no request of their own.
  const personal = useProofingPersonalWords(active).data?.words;
  const ignored = useProofingNoteIgnores(active ? noteId : undefined).data?.words;
  // A word cannot hold a newline, so a blank line keeps the two lists apart in the key.
  const wordsKey = useMemo(
    () => `${personal?.map((entry) => entry.word).join('\n') ?? ''}\n\n${ignored?.join('\n') ?? ''}`,
    [personal, ignored],
  );

  useEffect(() => {
    const text = title.trim();
    if (!active || text.length === 0 || languagesKey === '') {
      setIssues(NO_ISSUES);
      return;
    }

    const controller = new AbortController();
    void client
      .check(
        { languages: languagesKey.split(','), noteId, paragraphs: [{ id: TITLE_SEGMENT_ID, text }] },
        controller.signal,
      )
      .then((answer) => {
        if (controller.signal.aborted) return;
        setIssues(answer.paragraphs.find((paragraph) => paragraph.id === TITLE_SEGMENT_ID)?.issues ?? NO_ISSUES);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        // A dictionary still being read answers 503. The status poll moves the language
        // set once it is ready, and that asks again; anything else leaves the title unmarked.
        if (!isDictionaryLoading(error)) setIssues(NO_ISSUES);
      });
    return () => controller.abort();
  }, [active, title, languagesKey, noteId, client, wordsKey]);

  return issues;
}
