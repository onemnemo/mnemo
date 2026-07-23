// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';

import { createDocumentMapper } from '../mapper/document';
import { createEditorSchema } from '../schema';
import { defaultTextStyle, type Block } from '../../model/types';
import { blockIdentityPlugin, type BlockIdentityDeps } from './block-identity';

const { schema, registry } = createEditorSchema();
const mapper = createDocumentMapper(schema, registry);

/** Predictable identifiers, so an assertion can name the one it expects. */
function countingDeps(): BlockIdentityDeps {
  let sids = 0;
  let ids = 0;
  return {
    mintBlockSid: () => `mint${String(++sids)}`,
    newBlockId: () => `uuid-${String(++ids)}`,
  };
}

function blockOf(text: string, index: number): Block {
  return {
    id: `id-${String(index)}`,
    sid: `s${String(index).padStart(4, '0')}`,
    type: 'Text',
    spans: [{ kind: 'text', text, style: { ...defaultTextStyle } }],
    payload: { kind: 'empty' },
    meta: {},
    order: index,
    children: null,
  };
}

function stateOf(texts: readonly string[], deps = countingDeps()): EditorState {
  const result = mapper.toDoc(texts.map(blockOf));
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  return EditorState.create({
    doc: result.doc,
    schema,
    plugins: [blockIdentityPlugin(registry, deps)],
  });
}

/** Every top-level block's identifiers, in document order. */
function identities(doc: PMNode): { sid: string; id: string }[] {
  const out: { sid: string; id: string }[] = [];
  doc.forEach((node) => out.push({ sid: String(node.attrs.sid), id: String(node.attrs.id) }));
  return out;
}

/** Inserts a bare paragraph, what a split or an invariant leaves behind. */
function insertBareBlock(state: EditorState, at: number): EditorState {
  const bare = schema.nodes.paragraph.create(null, schema.nodes.line.create());
  return state.apply(state.tr.insert(at, bare));
}

describe('minting', () => {
  it('gives a block created with schema defaults both identifiers', () => {
    const state = stateOf(['hello']);
    const next = insertBareBlock(state, state.doc.content.size);

    expect(identities(next.doc)).toEqual([
      { sid: 's0000', id: 'id-0' },
      { sid: 'mint1', id: 'uuid-1' },
    ]);
  });

  it('leaves an existing block untouched', () => {
    const state = stateOf(['a', 'b']);
    const next = insertBareBlock(state, state.doc.content.size);
    expect(identities(next.doc).slice(0, 2)).toEqual([
      { sid: 's0000', id: 'id-0' },
      { sid: 's0001', id: 'id-1' },
    ]);
  });

  it('gives two blocks created in one transaction different sids', () => {
    const state = stateOf(['hello']);
    const bare = () => schema.nodes.paragraph.create(null, schema.nodes.line.create());
    const end = state.doc.content.size;
    const next = state.apply(state.tr.insert(end, bare()).insert(end, bare()));

    const sids = identities(next.doc).map((each) => each.sid);
    expect(new Set(sids).size).toBe(sids.length);
  });

  it('mints a whole run of new blocks with distinct ids, leaving the rest alone', () => {
    // A paste-shaped change: many bare blocks appended in one transaction. Each
    // must get its own non-empty sid and id, and the existing block is untouched.
    const state = stateOf(['keep']);
    const bare = () => schema.nodes.paragraph.create(null, schema.nodes.line.create());
    let tr = state.tr;
    const end = state.doc.content.size;
    for (let i = 0; i < 6; i++) tr = tr.insert(end, bare());
    const next = state.apply(tr);

    const all = identities(next.doc);
    expect(all[0]).toEqual({ sid: 's0000', id: 'id-0' }); // the original, untouched
    const minted = all.slice(1);
    expect(minted).toHaveLength(6);
    for (const each of minted) {
      expect(each.sid).not.toBe('');
      expect(each.id).not.toBe('');
    }
    const sids = minted.map((each) => each.sid);
    expect(new Set(sids).size).toBe(sids.length); // all distinct
  });

  it('hands the mint every sid the document already holds', () => {
    // Uniqueness is checked rather than assumed: the mint is told what is taken
    // instead of being trusted to be collision-free on its own.
    let seen: ReadonlySet<string> | null = null;
    const deps: BlockIdentityDeps = {
      mintBlockSid: (taken) => {
        // Copied: the plugin keeps adding to this set as it mints.
        seen = new Set(taken);
        return 'fresh';
      },
      newBlockId: () => 'uuid',
    };
    const state = stateOf(['a', 'b'], deps);
    insertBareBlock(state, state.doc.content.size);
    expect(seen === null ? [] : [...seen].sort()).toEqual(['s0000', 's0001']);
  });

  it('mints for any block type, not only the one a split makes', () => {
    const state = stateOf(['hello']);
    const bullet = schema.nodes.bulletItem.create(null, schema.nodes.line.create());
    const next = state.apply(state.tr.insert(state.doc.content.size, bullet));
    const created = next.doc.child(next.doc.childCount - 1);
    expect(String(created.attrs.sid)).toBe('mint1');
  });
});

describe('when it stays out of the way', () => {
  it('appends nothing for a keystroke that only edits text', () => {
    const state = stateOf(['hello']);
    let appended = 0;
    const watched = EditorState.create({
      doc: state.doc,
      schema,
      plugins: [
        blockIdentityPlugin(registry, {
          mintBlockSid: () => {
            appended += 1;
            return 'x';
          },
          newBlockId: () => 'y',
        }),
      ],
    });
    watched.apply(watched.tr.insertText('!', 2));
    // The document-wide sid walk is the expensive part, and typing must not
    // reach it at all.
    expect(appended).toBe(0);
  });

  it('appends nothing for a selection move', () => {
    const state = stateOf(['hello']);
    const next = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2)));
    expect(identities(next.doc)).toEqual([{ sid: 's0000', id: 'id-0' }]);
  });

  it('settles in one round rather than appending forever', () => {
    const state = stateOf(['hello']);
    const next = insertBareBlock(state, state.doc.content.size);
    // Applying an ordinary edit on top must not find anything left to do, if
    // it did, the append loop would never terminate in the real editor.
    const after = next.apply(next.tr.insertText('x', 2));
    expect(identities(after.doc)).toEqual([
      { sid: 's0000', id: 'id-0' },
      { sid: 'mint1', id: 'uuid-1' },
    ]);
  });
});
