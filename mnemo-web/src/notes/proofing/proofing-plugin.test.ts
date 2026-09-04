/**
 * The plugin's whole contract: map, replace one segment's worth, cap what one
 * note may hold, and never do anything else.
 */

import { EditorState } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';

import { blockOf, docOf, liveSegmentIds, locatedIssueFor, registry, schema, text } from './fixtures';
import { checkableSegments, resolveRange } from './segments';
import {
  MAX_ISSUES_PER_NOTE,
  getProofingState,
  issueAt,
  proofingIssues,
  proofingKey,
  proofingPlugin,
  type LocatedIssue,
  type ProofingMeta,
} from './proofing-plugin';

function stateOf(...spans: { sid: string; value: string }[]): EditorState {
  return EditorState.create({
    schema,
    doc: docOf(spans.map((entry) => blockOf({ sid: entry.sid, spans: [text(entry.value)] }))),
    plugins: [proofingPlugin()],
  });
}

function issueFor(state: EditorState, sid: string, word: string): LocatedIssue {
  return locatedIssueFor(state.doc, sid, word);
}

function send(state: EditorState, meta: ProofingMeta): EditorState {
  return state.apply(state.tr.setMeta(proofingKey, meta));
}

/** An answer meta carrying the document's real segment set, as the scheduler builds it. */
function answers(state: EditorState, segmentIds: string[], issues: LocatedIssue[]): ProofingMeta {
  return { type: 'answers', segmentIds, issues, liveSegmentIds: liveSegmentIds(state.doc) };
}

function decorationRanges(state: EditorState): [number, number][] {
  return getProofingState(state)
    .marks.find()
    .map((deco) => [deco.from, deco.to] as [number, number]);
}

describe('the proofing plugin', () => {
  it('draws one mark per placed issue', () => {
    let state = stateOf({ sid: 'a', value: 'teh cat sat' });
    const located = issueFor(state, 'a', 'teh');
    state = send(state, answers(state, ['a:0'], [located]));

    expect(decorationRanges(state)).toEqual([[located.from, located.to]]);
    expect(proofingIssues(state)).toHaveLength(1);
    expect(getProofingState(state).count).toBe(1);
  });

  it('replaces one segment without blanking the marks on every other', () => {
    let state = stateOf({ sid: 'a', value: 'teh cat' }, { sid: 'b', value: 'recieve it' });
    const first = issueFor(state, 'a', 'teh');
    const second = issueFor(state, 'b', 'recieve');
    state = send(state, answers(state, ['a:0'], [first]));
    state = send(state, answers(state, ['b:0'], [second]));

    expect(proofingIssues(state).map((located) => located.issue.text)).toEqual(['teh', 'recieve']);

    // A fresh answer for `a` alone drops `a`'s old issue and keeps `b`'s.
    state = send(state, answers(state, ['a:0'], []));
    expect(proofingIssues(state).map((located) => located.issue.text)).toEqual(['recieve']);
    expect(getProofingState(state).count).toBe(1);
  });

  it('maps its marks through an edit made ahead of them', () => {
    let state = stateOf({ sid: 'a', value: 'teh cat' });
    const located = issueFor(state, 'a', 'cat');
    state = send(state, answers(state, ['a:0'], [located]));

    const inserted = 'the quick ';
    state = state.apply(state.tr.insertText(inserted, located.from - 4));
    const [range] = decorationRanges(state);
    expect(range).toEqual([located.from + inserted.length, located.to + inserted.length]);
    expect(state.doc.textBetween(range[0], range[1])).toBe('cat');
  });

  it('carries an untouched issue through a keystroke as the same object', () => {
    let state = stateOf({ sid: 'a', value: 'teh cat' }, { sid: 'b', value: 'recieve it' });
    const first = issueFor(state, 'a', 'teh');
    const second = issueFor(state, 'b', 'recieve');
    state = send(state, answers(state, ['a:0', 'b:0'], [first, second]));

    const before = proofingIssues(state).map((located) => located.issue);
    state = state.apply(state.tr.insertText('x', 3));
    const after = proofingIssues(state).map((located) => located.issue);

    // Identity, not equality. A keystroke that rebuilt every issue would put
    // the cost of the note's whole mark count on every character typed into it.
    expect(after).toHaveLength(before.length);
    for (let i = 0; i < after.length; i += 1) expect(after[i]).toBe(before[i]);
  });

  it('leaves no mark straddling a block boundary after a split', () => {
    let state = stateOf({ sid: 'a', value: 'teh cat sat' });
    const located = issueFor(state, 'a', 'sat');
    state = send(state, answers(state, ['a:0'], [located]));

    // Split the line between "cat" and "sat", the case that would leave a
    // decoration reaching across two blocks.
    state = state.apply(state.tr.split(located.from - 1, 2));

    for (const [from, to] of decorationRanges(state)) {
      expect(state.doc.resolve(from).parent).toBe(state.doc.resolve(to).parent);
      expect(state.doc.textBetween(from, to)).toBe('sat');
    }
  });

  it('drops a mark the edit collapsed rather than keeping an empty one', () => {
    let state = stateOf({ sid: 'a', value: 'teh cat' });
    const located = issueFor(state, 'a', 'teh');
    state = send(state, answers(state, ['a:0'], [located]));

    state = state.apply(state.tr.delete(located.from, located.to));
    expect(proofingIssues(state)).toHaveLength(0);
    expect(decorationRanges(state)).toEqual([]);
  });

  it('clears a word everywhere it is marked, without a recheck', () => {
    let state = stateOf({ sid: 'a', value: 'Mnemo is Mnemo' }, { sid: 'b', value: 'mnemo again' });
    const first = issueFor(state, 'a', 'Mnemo');
    const second = issueFor(state, 'b', 'mnemo');
    state = send(state, answers(state, ['a:0', 'b:0'], [first, second]));
    expect(proofingIssues(state)).toHaveLength(2);

    state = send(state, { type: 'dropWord', word: 'MNEMO' });
    expect(proofingIssues(state)).toHaveLength(0);
    expect(getProofingState(state).count).toBe(0);
  });

  it('finds the issue under a position, which is how the card is opened', () => {
    let state = stateOf({ sid: 'a', value: 'teh cat' });
    const located = issueFor(state, 'a', 'teh');
    state = send(state, answers(state, ['a:0'], [located]));

    expect(issueAt(state, located.from)?.issue.text).toBe('teh');
    expect(issueAt(state, located.to + 3)).toBeNull();
  });

  it('stops adding marks past the cap and reports the note as paused', () => {
    const state = saturated();

    // 2,400 flagged words offered; the note holds only what it said it would.
    expect(getProofingState(state).paused).toBe(true);
    expect(getProofingState(state).count).toBeLessThanOrEqual(MAX_ISSUES_PER_NOTE);
    expect(proofingIssues(state)).toHaveLength(getProofingState(state).count);
  });

  it('resumes once the body it filled up on is deleted', () => {
    let state = saturated();
    expect(getProofingState(state).count).toBeGreaterThan(0);

    state = state.apply(state.tr.delete(0, state.doc.content.size));

    // The mapped set is empty, so the count and the pause have to follow it.
    // A latch here leaves an empty note claiming to be full, saying so under
    // the word count, and never checked again for the rest of the session.
    expect(proofingIssues(state)).toHaveLength(0);
    expect(getProofingState(state).count).toBe(0);
    expect(getProofingState(state).paused).toBe(false);
  });

  it('resumes on a partial delete that drops it under the cap', () => {
    let state = saturated();
    const before = getProofingState(state).count;

    // Half the note, which takes well over a hundred marks with it.
    state = state.apply(state.tr.delete(0, Math.floor(state.doc.content.size / 2)));

    const after = getProofingState(state).count;
    expect(after).toBeLessThan(before);
    expect(after).toBe(proofingIssues(state).length);
    expect(getProofingState(state).paused).toBe(false);
  });
});

/** A note offered far more marks than one note may hold. */
function saturated(): EditorState {
  const words = Array.from({ length: 40 }, (_unused, i) => `w${String(i).padStart(3, '0')}`);
  let state = EditorState.create({
    schema,
    doc: docOf(
      Array.from({ length: 60 }, (_unused, block) =>
        blockOf({ sid: `s${String(block)}`, spans: [text(words.join(' '))] }),
      ),
    ),
    plugins: [proofingPlugin()],
  });

  for (const segment of checkableSegments(state.doc, registry)) {
    const issues: LocatedIssue[] = [];
    for (const word of words) {
      const start = segment.text.indexOf(word);
      const range = resolveRange(state.doc, segment, start, start + word.length, word);
      if (!range) continue;
      issues.push({
        from: range.from,
        to: range.to,
        issue: {
          segmentId: segment.id,
          text: word,
          kind: 'spelling',
          tone: 'error',
          segmentText: segment.text,
          segmentStart: start,
          segmentEnd: start + word.length,
        },
      });
    }
    state = send(state, answers(state, [segment.id], issues));
  }
  return state;
}
