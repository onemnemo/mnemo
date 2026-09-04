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
 *        -> { enabled, active: string[], languages: [{ id, name, region,
 *             installed, bundled, state: "ready" | "loading" | "absent",
 *             reasonKey?, license: { name, url } }], personalWordCount,
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
 *   POST /proofing/personal { word, language? }
 *   POST /proofing/personal/remove { word, language? }
 *   POST /proofing/notes/{noteId}/ignores { word }
 *
 * The host also serves a read and a removal for a note's ignore list. Nothing
 * here calls them, because no surface lists a note's ignored words yet, and a
 * method with no caller is a method nobody notices going wrong.
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

import { apiFetch, apiSend } from '@/api/client';
import type {
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
  addPersonalWord(word: string, language?: string | null): Promise<void>;
  removePersonalWord(word: string, language?: string | null): Promise<void>;
  addNoteIgnore(noteId: string, word: string): Promise<void>;
  noteLanguages(noteId: string, signal?: AbortSignal): Promise<NoteProofing>;
  setNoteLanguages(noteId: string, choice: NoteProofingChoice): Promise<NoteProofing>;
}

/**
 * How a request leaves the app. The default is the bearer-token fetch every
 * other surface uses, which resolves paths against the host's own origin.
 */
export interface ProofingTransport {
  json<T>(path: string, init?: RequestInit): Promise<T>;
  send(path: string, init?: RequestInit): Promise<void>;
}

export const defaultProofingTransport: ProofingTransport = {
  json: apiFetch,
  send: apiSend,
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

function post(transport: ProofingTransport, path: string, body: unknown): Promise<void> {
  return transport.send(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
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
    addPersonalWord: (word, language) => post(transport, '/proofing/personal', { word, language }),
    removePersonalWord: (word, language) =>
      post(transport, '/proofing/personal/remove', { word, language }),
    addNoteIgnore: (noteId, word) =>
      post(transport, `/proofing/notes/${encodeURIComponent(noteId)}/ignores`, { word }),
    noteLanguages: (noteId, signal) =>
      transport.json<NoteProofing>(noteLanguagesPath(noteId), { signal }),
    setNoteLanguages: (noteId, choice) =>
      sendJson<NoteProofing>(transport, 'PUT', noteLanguagesPath(noteId), choice),
  };
}
