// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { EditorState } from 'prosemirror-state';

import type { TranslateFn } from '@/i18n/types';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { blockSelectionKey } from '../../selection/block-selection-plugin';
import { block, span } from '../mapper/fixtures';
import type { BlockRegistry } from '../registry/build';
import { locateBlock } from './block-commands';
import { blockLabel, blockMenuItems, type BlockMenuEntry, type BlockMenuVerb } from './block-menu-items';

type Blocks = Parameters<typeof buildNoteEditState>[0];

/** Keys, not prose: a label assertion should fail on the wrong key, not the wrong wording. */
const t: TranslateFn = (_ns, key, params) =>
  params ? `${key}(${Object.values(params).join(',')})` : key;

function mount(blocks: Blocks): { state: EditorState; registry: BlockRegistry } {
  const built = buildNoteEditState(blocks);
  if (!built.ok) throw new Error('fixture did not build');
  return { state: built.state, registry: built.registry };
}

function three(): { state: EditorState; registry: BlockRegistry } {
  return mount([
    block('Text', [span('one')]),
    block('Text', [span('two')]),
    block('Text', [span('three')]),
  ]);
}

/** Position and sid of the top-level block at `index`. */
function at(state: EditorState, index: number): { pos: number; sid: string } {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += state.doc.child(i).nodeSize;
  return { pos, sid: String(state.doc.child(index).attrs.sid ?? '') };
}

/** The same state with `sids` marked as a live block selection. */
function withSelection(state: EditorState, sids: string[]): EditorState {
  return state.apply(
    state.tr.setMeta(blockSelectionKey, {
      type: 'set',
      selection: { selected: new Set(sids), anchorSid: sids[0] ?? null },
    }),
  );
}

function items(state: EditorState, registry: BlockRegistry, index: number): readonly BlockMenuEntry[] {
  const { pos, sid } = at(state, index);
  const node = state.doc.child(index);
  return blockMenuItems({ state, registry, node, location: locateBlock(state, registry, pos, sid), t });
}

function verb(entries: readonly BlockMenuEntry[], id: string): BlockMenuVerb {
  const found = entries.find((entry) => entry.id === id);
  if (!found || found.kind !== 'verb') throw new Error(`no verb ${id}`);
  return found;
}

describe('blockLabel', () => {
  it('names a heading by its level and a plain block by its type', () => {
    const { state } = mount([block('Heading2', [span('h')]), block('Quote', [span('q')])]);
    expect(blockLabel(state.doc.child(0), t)).toBe('Heading2');
    expect(blockLabel(state.doc.child(1), t)).toBe('Quote');
  });

  it('clamps a heading deeper than the bundle names to the last level it has', () => {
    const { state } = mount([block('Heading2', [span('h')])]);
    const deep = state.doc.child(0).type.create({ ...state.doc.child(0).attrs, level: 9 });
    expect(blockLabel(deep, t)).toBe('Heading4');
  });
});

describe('blockMenuItems', () => {
  it('gives every entry a unique id', () => {
    const { state, registry } = three();
    const ids: string[] = [];
    for (const entry of items(state, registry, 1)) {
      ids.push(entry.id);
      if (entry.kind === 'submenu') for (const child of entry.items) ids.push(child.id);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('disables the move that has no sibling to swap with', () => {
    const { state, registry } = three();
    expect(verb(items(state, registry, 0), 'move-up').disabled).toBe(true);
    expect(verb(items(state, registry, 0), 'move-down').disabled).toBe(false);
    expect(verb(items(state, registry, 2), 'move-up').disabled).toBe(false);
    expect(verb(items(state, registry, 2), 'move-down').disabled).toBe(true);
  });

  it('offers turn-into on text and marks the block its own current type', () => {
    const { state, registry } = mount([block('Heading2', [span('h')])]);
    const submenu = items(state, registry, 0).find((entry) => entry.kind === 'submenu');
    if (submenu?.kind !== 'submenu') throw new Error('no turn-into submenu');
    const current = submenu.items.filter((option) => option.kind === 'verb' && option.emphasis === true);
    expect(current.map((option) => option.id)).toEqual(['turn-into.heading2']);
  });

  it('omits turn-into on a block that has no text to convert', () => {
    const { state, registry } = mount([block('Divider', [])]);
    expect(items(state, registry, 0).some((entry) => entry.kind === 'submenu')).toBe(false);
  });

  it('refuses to delete the document’s only top-level block', () => {
    const { state, registry } = mount([block('Text', [span('only')])]);
    expect(verb(items(state, registry, 0), 'delete').disabled).toBe(true);
    const many = three();
    expect(verb(items(many.state, many.registry, 0), 'delete').disabled).toBe(false);
  });

  it('names the count on delete when the block is part of a multi-block selection', () => {
    const base = three();
    const selected = withSelection(base.state, [at(base.state, 0).sid, at(base.state, 1).sid]);
    const row = verb(items(selected, base.registry, 0), 'delete');
    expect(row.label).toBe('DeleteBlocksFormat(2)');
    // The selection announcer speaks the clear, so this verb stays quiet.
    expect(row.announce).toBeNull();
  });

  it('leaves delete per-block when the selection does not contain it', () => {
    const base = three();
    const selected = withSelection(base.state, [at(base.state, 2).sid]);
    const row = verb(items(selected, base.registry, 0), 'delete');
    expect(row.label).toBe('Delete');
    expect(row.announce).toBe('BlockDeleted');
  });

  it('takes the whole selection when the block is one of a single-block selection', () => {
    const base = three();
    const selected = withSelection(base.state, [at(base.state, 1).sid]);
    const row = verb(items(selected, base.registry, 1), 'delete');
    // One selected block reads as a plain Delete, but still runs the selection path.
    expect(row.label).toBe('Delete');
    expect(row.announce).toBeNull();
  });

  it('offers the glyph row on a callout and on nothing else', () => {
    const { state, registry } = mount([
      block('Callout', [span('remember')], { kind: 'callout', emoji: '💡', tone: 'note' }),
      block('Text', [span('after')]),
    ]);
    const row = items(state, registry, 0).find((entry) => entry.kind === 'request');
    expect(row?.label).toBe('CalloutIcon');
    expect(items(state, registry, 1).some((entry) => entry.kind === 'request')).toBe(false);
  });

  it('offers the glyph row on a callout that has no glyph, the only way back to one', () => {
    const { state, registry } = mount([
      block('Callout', [span('plain')], { kind: 'callout', emoji: '', tone: 'note' }),
    ]);
    expect(items(state, registry, 0).some((entry) => entry.kind === 'request')).toBe(true);
  });

  it('builds a transaction for every enabled verb', () => {
    const { state, registry } = three();
    for (const entry of items(state, registry, 1)) {
      if (entry.kind !== 'verb' || entry.disabled) continue;
      const loc = locateBlock(state, registry, at(state, 1).pos, at(state, 1).sid);
      if (!loc) throw new Error('block did not locate');
      expect(entry.build(state, loc)).not.toBeNull();
    }
  });
});

describe('blockMenuItems: nesting', () => {
  function nestedList(): { state: EditorState; registry: BlockRegistry } {
    return mount([
      block('BulletList', [span('a')], { kind: 'empty' }, {
        children: [block('BulletList', [span('b')])],
      }),
      block('BulletList', [span('c')]),
      block('Text', [span('p')]),
    ]);
  }

  /** Position and sid of the first nested child of the top-level block at `index`. */
  function childAt(state: EditorState, index: number): { pos: number; sid: string } {
    const top = at(state, index);
    const node = state.doc.child(index);
    const line = node.firstChild!;
    const child = node.child(1);
    return { pos: top.pos + 1 + line.nodeSize, sid: String(child.attrs.sid ?? '') };
  }

  it('offers indent and outdent on a list item, enabled by what is around it', () => {
    const { state, registry } = nestedList();
    const top = items(state, registry, 0);
    // The first item has nothing above it and nothing to come out of.
    expect(verb(top, 'indent').disabled).toBe(true);
    expect(verb(top, 'outdent').disabled).toBe(true);
    // The item below can go under the first; it is not nested.
    const second = items(state, registry, 1);
    expect(verb(second, 'indent').disabled).toBe(false);
    expect(verb(second, 'outdent').disabled).toBe(true);
  });

  it('enables outdent on a nested item', () => {
    const { state, registry } = nestedList();
    const { pos, sid } = childAt(state, 0);
    const node = state.doc.child(0).child(1);
    const entries = blockMenuItems({ state, registry, node, location: locateBlock(state, registry, pos, sid), t });
    expect(verb(entries, 'outdent').disabled).toBe(false);
    expect(verb(entries, 'indent').disabled).toBe(true);
    expect(verb(entries, 'outdent').announce).toBe('BlockOutdented');
  });

  it('omits both rows on a plain block', () => {
    const { state, registry } = nestedList();
    const ids = items(state, registry, 2).map((entry) => entry.id);
    expect(ids).not.toContain('indent');
    expect(ids).not.toContain('outdent');
  });

  it('builds the same move the keyboard makes', () => {
    const { state, registry } = nestedList();
    const second = items(state, registry, 1);
    const loc = locateBlock(state, registry, at(state, 1).pos, at(state, 1).sid)!;
    const tr = verb(second, 'indent').build(state, loc)!;
    expect(tr.doc.childCount).toBe(2);
    expect(tr.doc.child(0).childCount).toBe(3);
    expect(tr.doc.child(0).child(2).textContent).toBe('c');
  });
});
