/**
 * The three list item types.
 *
 * **These are flat sibling nodes, not a ProseMirror list.** No wrapping `<ul>`,
 * no `listItem` nesting. PM's list schema is good, and using it would let a user
 * build nested lists that the storage format has no way to persist, the C#
 * lifecycle code writes list items as flat siblings and nothing more. A schema
 * that permits states the wire cannot hold is a data-loss bug waiting for the
 * first user who presses Tab.
 */

import type { AnyBlockModule } from '../registry/types';
import type { BlockType } from '../../model/types';
import { defineBlock, type BlockDeps } from './shared';
import { convertHere } from './slash-insert';
import { checklistView } from './checklist-view';

export function bulletItemBlock(deps: BlockDeps): AnyBlockModule {
  return defineBlock(
    {
      nodeName: 'bulletItem',
      wireTypes: ['BulletList'],
      nodeOptions: {
        parseDOM: [{ tag: 'li[data-bullet]' }],
        toDOM: () => ['li', { 'data-bullet': '' }, 0],
      },
      attrsFrom: () => ({}),
      wireFrom: () => ({ type: 'BulletList' as BlockType, payload: { kind: 'empty' as const } }),
      toMarkdown: (_node, _ctx, inline) => `- ${inline}\n`,
      slash: [
        {
          label: 'BulletList',
          description: 'BulletListDescription',
          icon: 'notes/bullet-list',
          hint: '-',
          group: 'text',
          insert: convertHere('bulletItem'),
        },
      ],
    },
    deps,
  );
}

/**
 * The displayed number is **not** stored.
 *
 * It is recomputed from document order by a decoration plugin, for two reasons.
 * A stored index goes stale the moment a block is inserted above it, and a CSS
 * counter would have to be scoped somewhere, but the counter must not reset at
 * a column boundary, and the block tree emits a column's left cells then its
 * right cells with no break between them. Any scoping that produces correct CSS
 * nesting renumbers every existing note.
 *
 * `listNumberIndex` and `listNumber` do appear in real `meta` bags. They stay
 * there, untouched, as opaque passthrough: promoting them to attrs would store
 * the same value twice and create exactly the shadow-key divergence the
 * normalization pass exists to clean up.
 */
export function numberedItemBlock(deps: BlockDeps): AnyBlockModule {
  return defineBlock(
    {
      nodeName: 'numberedItem',
      wireTypes: ['NumberedList'],
      nodeOptions: {
        parseDOM: [{ tag: 'li[data-numbered]' }],
        toDOM: () => ['li', { 'data-numbered': '' }, 0],
      },
      attrsFrom: () => ({}),
      wireFrom: () => ({ type: 'NumberedList' as BlockType, payload: { kind: 'empty' as const } }),
      // Markdown renumbers on its own, so a literal `1.` is correct output.
      toMarkdown: (_node, _ctx, inline) => `1. ${inline}\n`,
      slash: [
        {
          label: 'NumberedList',
          description: 'NumberedListDescription',
          icon: 'notes/numbered-list',
          hint: '1.',
          group: 'text',
          insert: convertHere('numberedItem'),
        },
      ],
    },
    deps,
  );
}

export function checklistItemBlock(deps: BlockDeps): AnyBlockModule {
  return defineBlock<{ checked: boolean }>(
    {
      nodeName: 'checklistItem',
      wireTypes: ['Checklist'],
      attrs: { checked: { default: false } },
      nodeOptions: {
        parseDOM: [
          {
            tag: 'li[data-checklist]',
            getAttrs: (n) => ({
              checked: (n as HTMLElement).getAttribute('data-checked') === 'true',
            }),
          },
        ],
        toDOM: (node) => [
          'li',
          { 'data-checklist': '', 'data-checked': String(node.attrs.checked === true) },
          0,
        ],
      },
      attrsFrom: (block) => ({
        checked: block.payload.kind === 'checklist' ? block.payload.checked : false,
      }),
      wireFrom: (node) => ({
        type: 'Checklist' as BlockType,
        payload: { kind: 'checklist' as const, checked: node.attrs.checked === true },
      }),
      // A real clickable checkbox in front of the text; the toDOM marker alone
      // is decoration a click passes straight through.
      realizedView: checklistView,
      toMarkdown: (node, _ctx, inline) =>
        `- [${node.attrs.checked === true ? 'x' : ' '}] ${inline}\n`,
      slash: [
        {
          // The desktop names the row "To-do" but describes it as a checklist.
          // Both are kept so neither vocabulary misses in search.
          label: 'Todo',
          description: 'ChecklistDescription',
          icon: 'notes/todo',
          hint: '[]',
          group: 'text',
          insert: convertHere('checklistItem'),
        },
      ],
    },
    deps,
  );
}
