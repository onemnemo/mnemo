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
 * Each issue lives in its own decoration's spec rather than in a second list
 * beside the set. One structure means one map per transaction: an ordinary
 * keystroke pays for the decoration set alone, and every untouched issue comes
 * through as the same object it was, which is also what lets a card find the
 * issue it was opened for after the document has moved under it.
 *
 * A note is capped. Nothing stops a checker from flagging every word (a writer
 * whose language has no bundled dictionary resolves to English and does exactly
 * that), and tens of thousands of decorations would then put the cost of that
 * note on every keystroke for as long as it is open. Past the cap the marks
 * already placed stay, nothing more is added, and the surface says so.
 */

import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import type { ProofingFix, ProofingTone } from './types';

/**
 * The most marks one note may hold.
 *
 * Far above any real note's mistake count, and far below the point where
 * mapping the set costs a visible fraction of a keystroke.
 */
export const MAX_ISSUES_PER_NOTE = 2000;

/** What the answer said about one flagged range, plus the context a card needs. */
export interface ProofingIssue {
  readonly segmentId: string;
  readonly text: string;
  readonly kind: string;
  readonly tone: ProofingTone;
  readonly ruleId?: string;
  readonly titleKey?: string;
  readonly messageKey?: string;
  readonly fixes?: readonly ProofingFix[];
  /** The whole segment's text, so a suggestion can be asked for in context. */
  readonly segmentText: string;
  readonly segmentStart: number;
  readonly segmentEnd: number;
}

/** An issue and where it currently sits. */
export interface LocatedIssue {
  readonly from: number;
  readonly to: number;
  readonly issue: ProofingIssue;
}

interface MarkSpec {
  readonly segmentId: string;
  readonly issue: ProofingIssue;
}

export interface ProofingPluginState {
  /** The marks alone, one decoration per issue. */
  readonly marks: DecorationSet;
  /** The marks plus the open card's highlight, which is what the view draws. */
  readonly decorations: DecorationSet;
  readonly count: number;
  /** The cap was reached: no more marks are added and the note says so. */
  readonly paused: boolean;
  readonly openId: string | null;
}

export type ProofingMeta =
  /**
   * Replaces every issue belonging to `segmentIds` with `issues`, and drops
   * every mark whose segment is not in `liveSegmentIds` any more.
   */
  | {
      readonly type: 'answers';
      readonly segmentIds: readonly string[];
      readonly issues: readonly LocatedIssue[];
      readonly liveSegmentIds: readonly string[];
    }
  /** Drops the marks of segments that have stopped existing. */
  | { readonly type: 'prune'; readonly liveSegmentIds: readonly string[] }
  /** Drops every mark on a word, for an added or ignored word. */
  | { readonly type: 'dropWord'; readonly word: string }
  | { readonly type: 'clear' }
  | { readonly type: 'open'; readonly openId: string | null };

export const proofingKey = new PluginKey<ProofingPluginState>('notes-proofing');

const EMPTY: ProofingPluginState = {
  marks: DecorationSet.empty,
  decorations: DecorationSet.empty,
  count: 0,
  paused: false,
  openId: null,
};

export function getProofingState(state: EditorState): ProofingPluginState {
  return proofingKey.getState(state) ?? EMPTY;
}

export function dispatchProofing(view: EditorView, meta: ProofingMeta): void {
  view.dispatch(view.state.tr.setMeta(proofingKey, meta));
}

/** A stable identity for one issue, so the open card survives a remap. */
export function issueIdOf(issue: ProofingIssue): string {
  return `${issue.segmentId}:${String(issue.segmentStart)}`;
}

function markFor(located: LocatedIssue): Decoration {
  return Decoration.inline(
    located.from,
    located.to,
    { class: 'proof-mark', 'data-tone': located.issue.tone },
    { segmentId: located.issue.segmentId, issue: located.issue },
  );
}

/**
 * Whether any step took content out, which is the only way mapping can drop a
 * mark. An insertion cannot, so ordinary typing never pays for the recount
 * below.
 */
function removedContent(tr: Transaction): boolean {
  return tr.mapping.maps.some((map) => {
    let removed = false;
    map.forEach((oldStart, oldEnd) => {
      if (oldEnd > oldStart) removed = true;
    });
    return removed;
  });
}

/**
 * The set without the marks whose segment has stopped existing.
 *
 * A mark maps forward on its own and has no idea its owner is gone, and only a
 * later answer naming that segment would have taken it back. Nothing ever
 * names a segment that is no longer checkable, so a range delete across two
 * blocks, an inline code span over a whole line or a paragraph turned into a
 * block equation would each strand an underline over text that is not the
 * flagged word, for as long as the note stayed open.
 */
function withoutOrphans(set: DecorationSet, live: ReadonlySet<string>): DecorationSet {
  const orphans = set.find(undefined, undefined, (spec: Partial<MarkSpec>) =>
    spec.segmentId === undefined ? false : !live.has(spec.segmentId),
  );
  return orphans.length > 0 ? set.remove(orphans) : set;
}

/** The marks actually in the set, which is what the cap is really about. */
function countIn(set: DecorationSet): number {
  let total = 0;
  for (const decoration of set.find()) if (specOf(decoration)) total += 1;
  return total;
}

function specOf(decoration: Decoration): MarkSpec | null {
  const spec = decoration.spec as Partial<MarkSpec>;
  return spec.issue && spec.segmentId !== undefined ? (spec as MarkSpec) : null;
}

function locate(decoration: Decoration): LocatedIssue | null {
  const spec = specOf(decoration);
  return spec ? { from: decoration.from, to: decoration.to, issue: spec.issue } : null;
}

/**
 * The set the view draws: the marks, plus an outline over the word the open
 * card belongs to. An outline rather than a deeper tint, because it takes no
 * room in the line box, so marking the active word cannot reflow the paragraph
 * the card is pointing at.
 */
function rendered(doc: PMNode, marks: DecorationSet, openId: string | null): DecorationSet {
  if (openId === null) return marks;
  const open = marks
    .find(undefined, undefined, (spec: Partial<MarkSpec>) =>
      Boolean(spec.issue && issueIdOf(spec.issue) === openId),
    )
    .at(0);
  if (!open) return marks;
  return marks.add(doc, [Decoration.inline(open.from, open.to, { class: 'is-open' })]);
}

/** Every issue currently marked, in document order. */
export function proofingIssues(state: EditorState): LocatedIssue[] {
  const out: LocatedIssue[] = [];
  for (const decoration of getProofingState(state).marks.find()) {
    const located = locate(decoration);
    if (located) out.push(located);
  }
  return out;
}

/**
 * The marked issue covering `pos`, if there is one.
 *
 * A range that strictly contains the position wins over one that merely ends or
 * starts there, so a caret between two marked words resolves to the word it is
 * inside rather than to whichever answer happened to arrive first.
 */
export function issueAt(state: EditorState, pos: number): LocatedIssue | null {
  let boundary: LocatedIssue | null = null;
  for (const decoration of getProofingState(state).marks.find(pos, pos)) {
    const located = locate(decoration);
    if (!located) continue;
    if (located.from < pos && pos < located.to) return located;
    boundary ??= located;
  }
  return boundary;
}

/**
 * The live copy of an issue: the same flagged word, at whatever position the
 * document has moved it to.
 *
 * Matched by object identity, which survives every remap because the payload
 * rides in the decoration's spec and mapping never rebuilds it. A suggestion is
 * applied against this, never against the range the card was opened with, so an
 * edit that landed while the card was open cannot make the replacement
 * overwrite the wrong text.
 */
export function currentIssue(state: EditorState, issue: ProofingIssue): LocatedIssue | null {
  for (const decoration of getProofingState(state).marks.find()) {
    if (specOf(decoration)?.issue === issue) return locate(decoration);
  }
  return null;
}

/**
 * Who wants to hear that the plugin's state moved.
 *
 * Kept off plugin state, which is rebuilt every transaction, and keyed by view
 * so a second editor never sees the first one's subscribers. The scheduler
 * listens here rather than wrapping `dispatch`, so nothing has to sit in the
 * path a keystroke takes.
 */
type ProofingListener = (state: ProofingPluginState, docChanged: boolean) => void;

const listeners = new WeakMap<EditorView, Set<ProofingListener>>();

export function subscribeProofing(view: EditorView, listener: ProofingListener): () => void {
  const set = listeners.get(view) ?? new Set<ProofingListener>();
  set.add(listener);
  listeners.set(view, set);
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

        let marks = old.marks;
        let decorations = old.decorations;
        let mappedCount = old.count;
        let mappedPaused = old.paused;
        if (tr.docChanged) {
          marks = old.marks.map(tr.mapping, tr.doc);
          // One map in the ordinary case: with no card open the two sets are
          // the same object, so a keystroke pays for the marks alone.
          decorations = old.openId === null ? marks : old.decorations.map(tr.mapping, tr.doc);

          // Mapping silently drops a mark whose range the edit collapsed, and
          // nothing tells the set's holder that it did. Without recounting, a
          // note that filled up and was then emptied would still report itself
          // full, keep saying so, and never be checked again.
          if (removedContent(tr)) {
            mappedCount = countIn(marks);
            mappedPaused = mappedPaused && mappedCount >= MAX_ISSUES_PER_NOTE;
          }
        }
        const mapped: ProofingPluginState = {
          ...old,
          marks,
          decorations,
          count: mappedCount,
          paused: mappedPaused,
        };

        if (!meta) return mapped;
        if (meta.type === 'clear') return EMPTY;

        if (meta.type === 'open') {
          return {
            ...mapped,
            openId: meta.openId,
            decorations: rendered(newState.doc, mapped.marks, meta.openId),
          };
        }

        let next = mapped.marks;
        let paused = mapped.paused;

        if (meta.type === 'dropWord') {
          const word = meta.word.toLocaleLowerCase();
          next = next.remove(
            next.find(
              undefined,
              undefined,
              (spec: Partial<MarkSpec>) => spec.issue?.text.toLocaleLowerCase() === word,
            ),
          );
        } else if (meta.type === 'prune') {
          next = withoutOrphans(next, new Set(meta.liveSegmentIds));
        } else {
          const replaced = new Set(meta.segmentIds);
          next = next.remove(
            next.find(undefined, undefined, (spec: Partial<MarkSpec>) =>
              spec.segmentId === undefined ? false : replaced.has(spec.segmentId),
            ),
          );
          next = withoutOrphans(next, new Set(meta.liveSegmentIds));
        }

        // Read back rather than adjusted: a prune and a replacement can both
        // take marks out in the same pass, and a running total that drifts is
        // what leaves an empty note claiming to be full.
        let count = countIn(next);
        paused = paused && count >= MAX_ISSUES_PER_NOTE;

        if (meta.type === 'answers' && meta.issues.length > 0) {
          if (count + meta.issues.length > MAX_ISSUES_PER_NOTE) paused = true;
          else {
            next = next.add(newState.doc, meta.issues.map(markFor));
            count += meta.issues.length;
          }
        }

        return {
          marks: next,
          decorations: rendered(newState.doc, next, mapped.openId),
          count,
          paused,
          openId: mapped.openId,
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
          const next = proofingKey.getState(updated.state);
          const previous = proofingKey.getState(prevState);
          if (next === undefined || next === previous) return;
          const set = listeners.get(updated);
          if (!set) return;
          const docChanged = prevState.doc !== updated.state.doc;
          for (const listener of set) listener(next, docChanged);
        },
        destroy() {
          listeners.delete(editorView);
        },
      };
    },
  });
}
