/**
 * The one place the proofing endpoints are named.
 *
 * Everything else in this folder takes a `ProofingClient`, so a test hands the
 * scheduler a stub and the app hands it this, and pointing the app at a
 * different origin is a change to `transport` alone.
 *
 * The contract, as both halves implement it:
 *
 *   GET  /proofing/status   (?noteId=... adds that note's own answer)
 *        -> { enabled, active: string[], languages: [{ id, name, nameKey,
 *             region, regionKey, installed, bundled,
 *             state: "ready" | "loading" | "absent", reasonKey?,
 *             license: { name, url } }], personalWordCount,
 *             note: { mode, languages, effective } | null }
 *   POST /proofing/check   { languages, noteId | null, paragraphs: [{ id, text }] }
 *        -> { languages, paragraphs: [{ id, issues: [{ start, end, text, kind,
 *             tone: "error" | "unknown", ruleId?, titleKey?, messageKey?,
 *             fixes?: [{ label?, replacement }] }] }] }
 *   POST /proofing/suggest { languages, noteId | null, text, start, end, ruleId? }
 *        -> { suggestions: [{ replacement, label? }] }
 *   GET  /proofing/notes/{noteId}/languages -> { mode, languages, effective }
 *   PUT  /proofing/notes/{noteId}/languages { mode, languages? }
 *        -> { mode, languages, effective }
 *   GET  /proofing/personal -> { words: [{ word, language | null, addedAt }] }
 *   POST /proofing/personal { word, language? }         -> { words: [...] }
 *   POST /proofing/personal/remove { word, language? }  -> { words: [...] }
 *   GET  /proofing/notes/{noteId}/ignores               -> { words: [...] }
 *   POST /proofing/notes/{noteId}/ignores { word }        -> { words: [...] }
 *   POST /proofing/notes/{noteId}/ignores/remove { word } -> { words: [...] }
 *
 * Every write to a word list answers with the whole list as it now stands, so a
 * caller reconciles its cache from the reply rather than fetching again.
 *
 * `id` is `"<blockSid>:<segmentIndex>"`, offsets are UTF-16 code units local to
 * the segment and `end` is exclusive. A check answers 503 while a dictionary is
 * still loading; the caller leaves those segments unchecked rather than
 * recording them as clean.
 *
 * The `languages` a check sends may only narrow the set the host resolved for
 * the note, never widen or replace it, and the answer echoes the set actually
 * used. That is what lets the editor check with the dictionaries already read
 * while another is still loading, and it is why an answer whose set differs
 * from the one asked about describes a state the caller no longer holds.
 */

import { apiFetch } from '@/api/client';
import type {
  NoteIgnores,
  NoteProofing,
  NoteProofingChoice,
  PersonalWords,
  ProofingCheckRequest,
  ProofingCheckResponse,
  ProofingStatus,
  ProofingSuggestRequest,
  ProofingSuggestResponse,
} from './types';

export interface ProofingClient {
  /** With a note id the answer also carries what that note is checked in. */
  status(noteId?: string | null, signal?: AbortSignal): Promise<ProofingStatus>;
  check(request: ProofingCheckRequest, signal?: AbortSignal): Promise<ProofingCheckResponse>;
  suggest(request: ProofingSuggestRequest, signal?: AbortSignal): Promise<ProofingSuggestResponse>;
  personal(signal?: AbortSignal): Promise<PersonalWords>;
  /** Both answer with the whole list as it now stands, so a caller updates its cache from the reply. */
  addPersonalWord(word: string, language?: string | null): Promise<PersonalWords>;
  removePersonalWord(word: string, language?: string | null): Promise<PersonalWords>;
  noteIgnores(noteId: string, signal?: AbortSignal): Promise<NoteIgnores>;
  addNoteIgnore(noteId: string, word: string): Promise<NoteIgnores>;
  removeNoteIgnore(noteId: string, word: string): Promise<NoteIgnores>;
  noteLanguages(noteId: string, signal?: AbortSignal): Promise<NoteProofing>;
  setNoteLanguages(noteId: string, choice: NoteProofingChoice): Promise<NoteProofing>;
}

/**
 * How a request leaves the app. The default is the bearer-token fetch every
 * other surface uses, which resolves paths against the host's own origin.
 */
export interface ProofingTransport {
  json<T>(path: string, init?: RequestInit): Promise<T>;
}

export const defaultProofingTransport: ProofingTransport = {
  json: apiFetch,
};

/**
 * Whether a failed check should be retried rather than treated as an answer.
 *
 * 503 is the host saying the dictionary is still loading. Structural rather
 * than an `instanceof` check so an injected transport can report the same
 * condition without importing the app's error class.
 */
export function isDictionaryLoading(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: number }).status === 503;
}

function sendJson<T>(
  transport: ProofingTransport,
  method: 'POST' | 'PUT',
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return transport.json<T>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

function noteLanguagesPath(noteId: string): string {
  return `/proofing/notes/${encodeURIComponent(noteId)}/languages`;
}

function noteIgnoresPath(noteId: string): string {
  return `/proofing/notes/${encodeURIComponent(noteId)}/ignores`;
}

export function createProofingClient(
  transport: ProofingTransport = defaultProofingTransport,
): ProofingClient {
  return {
    status: (noteId, signal) =>
      transport.json<ProofingStatus>(
        noteId ? `/proofing/status?noteId=${encodeURIComponent(noteId)}` : '/proofing/status',
        { signal },
      ),
    check: (request, signal) =>
      sendJson<ProofingCheckResponse>(transport, 'POST', '/proofing/check', request, signal),
    suggest: (request, signal) =>
      sendJson<ProofingSuggestResponse>(transport, 'POST', '/proofing/suggest', request, signal),
    personal: (signal) => transport.json<PersonalWords>('/proofing/personal', { signal }),
    addPersonalWord: (word, language) =>
      sendJson<PersonalWords>(transport, 'POST', '/proofing/personal', { word, language }),
    removePersonalWord: (word, language) =>
      sendJson<PersonalWords>(transport, 'POST', '/proofing/personal/remove', { word, language }),
    noteIgnores: (noteId, signal) =>
      transport.json<NoteIgnores>(noteIgnoresPath(noteId), { signal }),
    addNoteIgnore: (noteId, word) =>
      sendJson<NoteIgnores>(transport, 'POST', noteIgnoresPath(noteId), { word }),
    removeNoteIgnore: (noteId, word) =>
      sendJson<NoteIgnores>(transport, 'POST', `${noteIgnoresPath(noteId)}/remove`, { word }),
    noteLanguages: (noteId, signal) =>
      transport.json<NoteProofing>(noteLanguagesPath(noteId), { signal }),
    setNoteLanguages: (noteId, choice) =>
      sendJson<NoteProofing>(transport, 'PUT', noteLanguagesPath(noteId), choice),
  };
}
