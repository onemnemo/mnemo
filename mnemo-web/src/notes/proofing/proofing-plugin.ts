/**
 * Proofing underlines, as decorations over the document.
 *
 * The plugin does two things and refuses a third. It maps what it holds through
 * every transaction, and it installs answers delivered on a meta. It never
 * enqueues a check, never reads the network and never touches the document.
 * That refusal is the load-bearing part: a chunked mount appends up to a
 * thousand blocks in a single transaction, and a plugin that scheduled work
 * from `apply` would fire a request storm on the frame a large note opens.
 * Scheduling lives in the view hook, which can pace itself.
 *
 * Answers arrive already located, because only the caller knows which document
 * a request was built from. It resolves each issue against the live document
 * and drops any whose text no longer round trips, so nothing here has to guess
 * whether a stored range still means what it meant.
 */

import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import type { ProofingFix, ProofingTone } from './types';

/** One issue, located in the document it was answered against. */
export interface PlacedIssue {
  readonly segmentId: string;
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly kind: string;
  readonly tone: ProofingTone;
  readonly ruleId?: string;
  readonly titleKey?: string;
  readonly messageKey?: string;
  readonly fixes?: readonly ProofingFix[];
  /** The whole segment's text, so a suggestion can be asked for in context. */
  readonly segmentText: string;
  /** Where the issue sits inside `segmentText`. */
  readonly segmentStart: number;
  readonly segmentEnd: number;
}

export interface ProofingPluginState {
  readonly issues: readonly PlacedIssue[];
  readonly decorations: DecorationSet;
  /** The issue the open card belongs to, so its mark can read as active. */
  readonly openId: string | null;
}

export type ProofingMeta =
  /** Replaces every issue belonging to `segmentIds` with `issues`. */
  | { readonly type: 'answers'; readonly segmentIds: readonly string[]; readonly issues: readonly PlacedIssue[] }
  /** Drops every mark on a word, for an added or ignored word. */
  | { readonly type: 'dropWord'; readonly word: string }
  | { readonly type: 'clear' }
  | { readonly type: 'open'; readonly openId: string | null };

export const proofingKey = new PluginKey<ProofingPluginState>('notes-proofing');

const EMPTY: ProofingPluginState = {
  issues: [],
  decorations: DecorationSet.empty,
  openId: null,
};

export function getProofingState(state: EditorState): ProofingPluginState {
  return proofingKey.getState(state) ?? EMPTY;
}

export function dispatchProofing(view: EditorView, meta: ProofingMeta): void {
  view.dispatch(view.state.tr.setMeta(proofingKey, meta));
}

/** A stable identity for one issue, so the open card survives a remap. */
export function issueIdOf(issue: PlacedIssue): string {
  return `${issue.segmentId}:${String(issue.segmentStart)}`;
}

function decorationsFor(doc: PMNode, issues: readonly PlacedIssue[], openId: string | null): DecorationSet {
  const decos: Decoration[] = [];
  for (const issue of issues) {
    if (issue.to <= issue.from) continue;
    const active = openId !== null && issueIdOf(issue) === openId;
    decos.push(
      Decoration.inline(issue.from, issue.to, {
        class: active ? 'proof-mark is-open' : 'proof-mark',
        'data-tone': issue.tone,
      }),
    );
  }
  return DecorationSet.create(doc, decos);
}

/**
 * Maps issues forward and drops the ones an edit collapsed.
 *
 * Bias the ends outward so typing inside a flagged word keeps the mark over
 * the word being repaired rather than splitting it; a collapsed range means
 * the word is gone, and its issue with it.
 */
function mapIssues(issues: readonly PlacedIssue[], tr: Transaction): PlacedIssue[] {
  const out: PlacedIssue[] = [];
  for (const issue of issues) {
    const from = tr.mapping.map(issue.from, 1);
    const to = tr.mapping.map(issue.to, -1);
    if (to <= from) continue;
    out.push({ ...issue, from, to });
  }
  return out;
}

function sameWord(a: string, b: string): boolean {
  return a.toLocaleLowerCase() === b.toLocaleLowerCase();
}

/** The marked issue covering `pos`, if there is one. */
export function issueAt(state: EditorState, pos: number): PlacedIssue | null {
  for (const issue of getProofingState(state).issues) {
    if (pos >= issue.from && pos <= issue.to) return issue;
  }
  return null;
}

/**
 * The live copy of an issue: the same flagged word in the same segment, at
 * whatever position the document has moved it to.
 *
 * A suggestion is applied against this, never against the range the card was
 * opened with, so an edit that landed while the card was open cannot make the
 * replacement overwrite the wrong text.
 */
export function currentIssue(state: EditorState, issue: PlacedIssue): PlacedIssue | null {
  const id = issueIdOf(issue);
  for (const candidate of getProofingState(state).issues) {
    if (issueIdOf(candidate) === id && candidate.text === issue.text) return candidate;
  }
  return null;
}

/**
 * Who wants to hear that the document changed.
 *
 * Kept off plugin state, which is rebuilt every transaction, and keyed by view
 * so a second editor never sees the first one's subscribers. The scheduler
 * listens here rather than wrapping `dispatch`, so nothing has to sit in the
 * path a keystroke takes.
 */
const editListeners = new WeakMap<EditorView, Set<() => void>>();

export function subscribeProofingEdits(view: EditorView, listener: () => void): () => void {
  const set = editListeners.get(view) ?? new Set<() => void>();
  set.add(listener);
  editListeners.set(view, set);
  return () => {
    set.delete(listener);
  };
}

export function proofingPlugin(): Plugin<ProofingPluginState> {
  return new Plugin<ProofingPluginState>({
    key: proofingKey,
    state: {
      init: () => EMPTY,
      apply(tr, old, _oldState, newState): ProofingPluginState {
        const meta = tr.getMeta(proofingKey) as ProofingMeta | undefined;

        const mapped: ProofingPluginState = tr.docChanged
          ? {
              ...old,
              issues: mapIssues(old.issues, tr),
              decorations: old.decorations.map(tr.mapping, tr.doc),
            }
          : old;

        if (!meta) return mapped;

        if (meta.type === 'clear') return EMPTY;

        if (meta.type === 'open') {
          return {
            ...mapped,
            openId: meta.openId,
            decorations: decorationsFor(newState.doc, mapped.issues, meta.openId),
          };
        }

        const issues =
          meta.type === 'answers'
            ? replaceSegments(mapped.issues, meta.segmentIds, meta.issues)
            : mapped.issues.filter((issue) => !sameWord(issue.text, meta.word));

        return {
          issues,
          openId: mapped.openId,
          decorations: decorationsFor(newState.doc, issues, mapped.openId),
        };
      },
    },
    props: {
      decorations(this: Plugin<ProofingPluginState>, state) {
        return this.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
    view(editorView) {
      return {
        update(updated, prevState) {
          if (prevState.doc === updated.state.doc) return;
          const set = editListeners.get(updated);
          if (!set) return;
          for (const listener of set) listener();
        },
        destroy() {
          editListeners.delete(editorView);
        },
      };
    },
  });
}

/**
 * Every issue outside the answered segments, plus the answered ones.
 *
 * Per segment rather than per document: an answer covers the batch that was
 * asked about and says nothing about the rest of the note, so replacing the
 * whole set would blank every mark the previous batches produced.
 */
function replaceSegments(
  issues: readonly PlacedIssue[],
  segmentIds: readonly string[],
  answered: readonly PlacedIssue[],
): PlacedIssue[] {
  const replaced = new Set(segmentIds);
  const kept = issues.filter((issue) => !replaced.has(issue.segmentId));
  return [...kept, ...answered];
}
