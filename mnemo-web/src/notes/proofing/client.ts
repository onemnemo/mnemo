/**
 * The one place the proofing endpoints are named.
 *
 * Everything else in this folder takes a `ProofingClient`, so a test hands the
 * scheduler a stub and the app hands it this, and pointing the app at a
 * different origin is a change to `transport` alone.
 *
 * The contract, as both halves implement it:
 *
 *   GET  /proofing/status
 *        -> { enabled, language, languages: [{ id, name, region, installed,
 *             bundled, state: "ready" | "loading" | "absent", reasonKey?,
 *             license: { name, url } }], personalWordCount }
 *   POST /proofing/check   { language, noteId | null, paragraphs: [{ id, text }] }
 *        -> { language, paragraphs: [{ id, issues: [{ start, end, text, kind,
 *             tone: "error" | "unknown", ruleId?, titleKey?, messageKey?,
 *             fixes?: [{ label?, replacement }] }] }] }
 *   POST /proofing/suggest { language, text, start, end, ruleId? }
 *        -> { suggestions: [{ replacement, label? }] }
 *   GET  /proofing/personal -> { words: [{ word, language | null, addedAt }] }
 *   POST /proofing/personal { word, language? }
 *   POST /proofing/personal/remove { word, language? }
 *   GET  /proofing/notes/{noteId}/ignores -> { words }
 *   POST /proofing/notes/{noteId}/ignores { word }
 *   POST /proofing/notes/{noteId}/ignores/remove { word }
 *
 * `id` is `"<blockSid>:<segmentIndex>"`, offsets are UTF-16 code units local to
 * the segment and `end` is exclusive. A check answers 503 while a dictionary is
 * still loading; the caller leaves those segments unchecked rather than
 * recording them as clean.
 */

import { apiFetch, apiSend } from '@/api/client';
import type {
  NoteIgnores,
  PersonalWords,
  ProofingCheckRequest,
  ProofingCheckResponse,
  ProofingStatus,
  ProofingSuggestRequest,
  ProofingSuggestResponse,
} from './types';

export interface ProofingClient {
  status(signal?: AbortSignal): Promise<ProofingStatus>;
  check(request: ProofingCheckRequest, signal?: AbortSignal): Promise<ProofingCheckResponse>;
  suggest(request: ProofingSuggestRequest, signal?: AbortSignal): Promise<ProofingSuggestResponse>;
  personal(signal?: AbortSignal): Promise<PersonalWords>;
  addPersonalWord(word: string, language?: string | null): Promise<void>;
  removePersonalWord(word: string, language?: string | null): Promise<void>;
  noteIgnores(noteId: string, signal?: AbortSignal): Promise<NoteIgnores>;
  addNoteIgnore(noteId: string, word: string): Promise<void>;
  removeNoteIgnore(noteId: string, word: string): Promise<void>;
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

function postJson<T>(
  transport: ProofingTransport,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return transport.json<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

export function createProofingClient(
  transport: ProofingTransport = defaultProofingTransport,
): ProofingClient {
  return {
    status: (signal) => transport.json<ProofingStatus>('/proofing/status', { signal }),
    check: (request, signal) =>
      postJson<ProofingCheckResponse>(transport, '/proofing/check', request, signal),
    suggest: (request, signal) =>
      postJson<ProofingSuggestResponse>(transport, '/proofing/suggest', request, signal),
    personal: (signal) => transport.json<PersonalWords>('/proofing/personal', { signal }),
    addPersonalWord: (word, language) => post(transport, '/proofing/personal', { word, language }),
    removePersonalWord: (word, language) =>
      post(transport, '/proofing/personal/remove', { word, language }),
    noteIgnores: (noteId, signal) =>
      transport.json<NoteIgnores>(`/proofing/notes/${encodeURIComponent(noteId)}/ignores`, { signal }),
    addNoteIgnore: (noteId, word) =>
      post(transport, `/proofing/notes/${encodeURIComponent(noteId)}/ignores`, { word }),
    removeNoteIgnore: (noteId, word) =>
      post(transport, `/proofing/notes/${encodeURIComponent(noteId)}/ignores/remove`, { word }),
  };
}
