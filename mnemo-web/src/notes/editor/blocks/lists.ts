/**
 * The three list item types.
 *
 * **Sibling nodes, not a ProseMirror list.** There is no wrapping `<ul>` and no
 * `listItem` node: a run of items is a list because the items sit next to each
 * other, exactly as the wire format stores them. A nested list is the block
 * children every block already carries, so an item's sub-list is its `children`
 * on the wire and its trailing block nodes in the document, and the nesting
 * commands (`commands/list-nesting.ts`) only ever move whole items in and out
 * of a neighbour. Both readers of the format walk children generically, so no
 * depth is ever a state the wire cannot hold.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { AnyBlockModule, MdContext } from '../registry/types';
import type { BlockType } from '../../model/types';
import { defineBlock, type BlockDeps } from './shared';
import { convertHere } from './slash-insert';
import { checklistView } from './checklist-view';

/**
 * An item's sub-list, indented under it. Two spaces per level under a bullet or
 * a checkbox and the marker's width under a numbered item, so a child line sits
 * at its parent's content column and CommonMark readers nest it too; our own
 * parsers accept anything deeper than the parent's own indent.
 */
function nestedMarkdown(node: PMNode, ctx: MdContext, indent: string): string {
  return ctx.serializeChildren(node).replace(/^(?=.)/gm, indent);
}

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
      toMarkdown: (node, ctx, inline) => `- ${inline}\n${nestedMarkdown(node, ctx, '  ')}`,
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
 * Only the run's start is stored, as `listStart` in the first item's `meta`
 * (see `list-start.ts`); every displayed number is recomputed from it
 * and document order by a decoration plugin. A stored index on each item goes
 * stale the moment a block is inserted above it, and a CSS counter would have
 * to be scoped somewhere, but the counter must not reset at a column boundary,
 * and the block tree emits a column's left cells then its right cells with no
 * break between them.
 *
 * The start stays in `meta` rather than an attr: promoting it would store the
 * same value twice and create exactly the shadow-key divergence the
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
      toMarkdown: (node, ctx, inline) => {
        const marker = `${ctx.listNumber}. `;
        return `${marker}${inline}\n${nestedMarkdown(node, ctx, ' '.repeat(marker.length))}`;
      },
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
      toMarkdown: (node, ctx, inline) =>
        `- [${node.attrs.checked === true ? 'x' : ' '}] ${inline}\n${nestedMarkdown(node, ctx, '  ')}`,
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
