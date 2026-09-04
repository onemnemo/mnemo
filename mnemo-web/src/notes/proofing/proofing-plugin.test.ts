/**
 * The plugin's whole contract: map, replace one segment's worth, and never do
 * anything else.
 */

import { EditorState } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';

import { blockOf, docOf, registry, schema, text } from './fixtures';
import { checkableSegments } from './segments';
import {
  getProofingState,
  issueAt,
  proofingKey,
  proofingPlugin,
  type PlacedIssue,
  type ProofingMeta,
} from './proofing-plugin';
import { projectDocument } from '../editor/projection/document';
import { resolveRange } from './segments';

function stateOf(...spans: { sid: string; value: string }[]): EditorState {
  return EditorState.create({
    schema,
    doc: docOf(spans.map((entry) => blockOf({ sid: entry.sid, spans: [text(entry.value)] }))),
    plugins: [proofingPlugin()],
  });
}

/** The issue a stubbed answer would place, resolved against the live document. */
function issueFor(state: EditorState, sid: string, word: string): PlacedIssue {
  const doc = state.doc;
  const projection = projectDocument(doc, registry);
  const segment = checkableSegments(doc, registry).find((entry) => entry.sid === sid);
  if (!segment) throw new Error(`no segment for ${sid}`);
  const start = segment.text.indexOf(word);
  const range = resolveRange(doc, projection, segment, start, start + word.length, word);
  if (!range) throw new Error(`could not resolve ${word}`);
  return {
    segmentId: segment.id,
    from: range.from,
    to: range.to,
    text: word,
    kind: 'spelling',
    tone: 'error',
    segmentText: segment.text,
    segmentStart: start,
    segmentEnd: start + word.length,
  };
}

function send(state: EditorState, meta: ProofingMeta): EditorState {
  return state.apply(state.tr.setMeta(proofingKey, meta));
}

function decorationRanges(state: EditorState): [number, number][] {
  return getProofingState(state)
    .decorations.find()
    .map((deco) => [deco.from, deco.to] as [number, number]);
}

describe('the proofing plugin', () => {
  it('draws one mark per placed issue', () => {
    let state = stateOf({ sid: 'a', value: 'teh cat sat' });
    const issue = issueFor(state, 'a', 'teh');
    state = send(state, { type: 'answers', segmentIds: ['a:0'], issues: [issue] });

    expect(decorationRanges(state)).toEqual([[issue.from, issue.to]]);
    expect(getProofingState(state).issues).toHaveLength(1);
  });

  it('replaces one segment without blanking the marks on every other', () => {
    let state = stateOf({ sid: 'a', value: 'teh cat' }, { sid: 'b', value: 'recieve it' });
    const first = issueFor(state, 'a', 'teh');
    const second = issueFor(state, 'b', 'recieve');
    state = send(state, { type: 'answers', segmentIds: ['a:0'], issues: [first] });
    state = send(state, { type: 'answers', segmentIds: ['b:0'], issues: [second] });

    expect(getProofingState(state).issues.map((issue) => issue.text)).toEqual(['teh', 'recieve']);

    // A fresh answer for `a` alone drops `a`'s old issue and keeps `b`'s.
    state = send(state, { type: 'answers', segmentIds: ['a:0'], issues: [] });
    expect(getProofingState(state).issues.map((issue) => issue.text)).toEqual(['recieve']);
  });

  it('maps its marks through an edit made ahead of them', () => {
    let state = stateOf({ sid: 'a', value: 'teh cat' });
    const issue = issueFor(state, 'a', 'cat');
    state = send(state, { type: 'answers', segmentIds: ['a:0'], issues: [issue] });

    const inserted = 'the quick ';
    state = state.apply(state.tr.insertText(inserted, issue.from - 4));
    const [range] = decorationRanges(state);
    expect(range).toEqual([issue.from + inserted.length, issue.to + inserted.length]);
    expect(state.doc.textBetween(range[0], range[1])).toBe('cat');
  });

  it('leaves no mark straddling a block boundary after a split', () => {
    let state = stateOf({ sid: 'a', value: 'teh cat sat' });
    const issue = issueFor(state, 'a', 'sat');
    state = send(state, { type: 'answers', segmentIds: ['a:0'], issues: [issue] });

    // Split the line between "cat" and "sat", the case that used to leave a
    // decoration reaching across two blocks.
    state = state.apply(state.tr.split(issue.from - 1, 2));

    for (const [from, to] of decorationRanges(state)) {
      expect(state.doc.resolve(from).parent).toBe(state.doc.resolve(to).parent);
      expect(state.doc.textBetween(from, to)).toBe('sat');
    }
  });

  it('drops a mark the edit collapsed rather than keeping an empty one', () => {
    let state = stateOf({ sid: 'a', value: 'teh cat' });
    const issue = issueFor(state, 'a', 'teh');
    state = send(state, { type: 'answers', segmentIds: ['a:0'], issues: [issue] });

    state = state.apply(state.tr.delete(issue.from, issue.to));
    expect(getProofingState(state).issues).toHaveLength(0);
    expect(decorationRanges(state)).toEqual([]);
  });

  it('clears a word everywhere it is marked, without a recheck', () => {
    let state = stateOf({ sid: 'a', value: 'Mnemo is Mnemo' }, { sid: 'b', value: 'mnemo again' });
    const first = issueFor(state, 'a', 'Mnemo');
    const second = issueFor(state, 'b', 'mnemo');
    state = send(state, { type: 'answers', segmentIds: ['a:0', 'b:0'], issues: [first, second] });
    expect(getProofingState(state).issues).toHaveLength(2);

    state = send(state, { type: 'dropWord', word: 'MNEMO' });
    expect(getProofingState(state).issues).toHaveLength(0);
  });

  it('finds the issue under a position, which is how the card is opened', () => {
    let state = stateOf({ sid: 'a', value: 'teh cat' });
    const issue = issueFor(state, 'a', 'teh');
    state = send(state, { type: 'answers', segmentIds: ['a:0'], issues: [issue] });

    expect(issueAt(state, issue.from)?.text).toBe('teh');
    expect(issueAt(state, issue.to + 3)).toBeNull();
  });
});
