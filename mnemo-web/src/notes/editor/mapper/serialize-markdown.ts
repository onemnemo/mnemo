/**
 * Document/fragment -> markdown, the copy path's plain text.
 *
 * Each block module renders itself (`serialize.toMarkdown`) but cannot reach into its
 * own children or inline content (see `MdContext`), so this supplies both and walks the
 * whole document through the registry.
 *
 * Blocks are joined the CommonMark way, as the host's exporter joins them: a blank line
 * between blocks and a single newline between list items, so a list stays tight. A
 * nested sub-list sits directly under its item. Columns have no markdown form and
 * flatten into the run, left cell first.
 */

import type { Fragment, Node as PMNode } from 'prosemirror-model';

import type { BlockRegistry } from '../registry/build';
import type { MdContext } from '../registry/types';
import type { InlineMapper } from './inline';
import { escapeMarkdownText, serializeInlineMarkdown } from '../../model/markdown-serialize';
import type { BlockType } from '../../model/types';
import { listStartOf, storedListStart } from '../blocks/list-start';
import { isListItem } from '../blocks/shared';

const LIST_TYPES: ReadonlySet<BlockType> = new Set<BlockType>(['BulletList', 'NumberedList', 'Checklist']);
const COLUMN_TYPES: ReadonlySet<BlockType> = new Set<BlockType>(['TwoColumn', 'ColumnGroup']);

interface Numbered {
  readonly number: number;
  /**
   * Whether the item opens a run at a number other than 1. CommonMark lets only
   * a 1 interrupt a paragraph, so such an item needs a blank line above it.
   */
  readonly opensPastOne: boolean;
  /** Whether the item ends the run above it and opens its own, see `splitRunsAtStarts`. */
  readonly splits: boolean;
}

/** The CommonMark way to end a list, so the items after it start one of their own. */
const RUN_BREAK = '<!-- -->\n\n';

/**
 * Numbers the blocks of one sibling run, `listDepth` list items down, the way the
 * editor does: from the start the first item stores.
 */
function listCounter(listDepth: number, splitAtStarts: boolean): (node: PMNode, numbered: boolean) => Numbered {
  let next: number | null = null;
  return (node, numbered) => {
    if (!numbered) {
      next = null;
      return { number: 1, opensPastOne: false, splits: false };
    }
    const stored = storedListStart(node.attrs.meta);
    const splits = next !== null && splitAtStarts && stored !== null && stored !== next;
    if (next !== null && !splits) return { number: next++, opensPastOne: false, splits };
    const start = listStartOf(node.attrs.meta, listDepth);
    next = start + 1;
    return { number: start, opensPastOne: start !== 1, splits };
  };
}

export interface MarkdownSerializer {
  /** The whole document as markdown, with no trailing blank line. */
  document(doc: PMNode): string;
  /** A fragment of whole top-level blocks, e.g. the content of a copied slice. */
  fragment(fragment: Fragment): string;
}

export interface MarkdownSerializerOptions {
  /**
   * How an empty paragraph is written. A markdown file spells it `&nbsp;` so it reads
   * back; the clipboard's plain text, read by people and other apps, leaves the line blank.
   */
  readonly emptyParagraph?: 'nbsp' | 'blank';
  /**
   * Whether a numbered item that stores a start other than the next number opens a
   * run of its own. A copy stores the shown number on each picked item that does not
   * count on from the one before it; in a document only a run's first item stores one.
   */
  readonly splitRunsAtStarts?: boolean;
}

export function createMarkdownSerializer(
  registry: BlockRegistry,
  inline: InlineMapper,
  options: MarkdownSerializerOptions = {},
): MarkdownSerializer {
  const emptyParagraph = options.emptyParagraph ?? 'nbsp';
  const splitAtStarts = options.splitRunsAtStarts ?? false;

  function serializeInline(line: PMNode): string {
    return serializeInlineMarkdown(inline.fromInline(line));
  }

  function contextAt(depth: number, listDepth: number, listNumber: number): MdContext {
    return {
      depth,
      serializeChildren: (node) => serializeFragment(node.content, depth + 1, isListItem(node) ? listDepth + 1 : listDepth),
      serializeInline,
      escapeText: escapeMarkdownText,
      emptyParagraph,
      listNumber,
    };
  }

  function isNumbered(wireTypes: readonly BlockType[]): boolean {
    return wireTypes.includes('NumberedList');
  }

  function serializeFragment(fragment: Fragment, depth: number, listDepth: number): string {
    let out = '';
    const count = listCounter(listDepth, splitAtStarts);
    fragment.forEach((child) => {
      const module = registry.byNodeName.get(child.type.name);
      // A `line`/`codeLine` child is inline content, not a block, and is never in the
      // registry; each module renders its own line through `serializeInline`.
      if (!module) return;
      const { number, opensPastOne, splits } = count(child, isNumbered(module.wireTypes));
      if (opensPastOne || splits) out += '\n';
      if (splits) out += RUN_BREAK;
      out += module.serialize.toMarkdown(child, contextAt(depth, listDepth, number));
    });
    return out;
  }

  /** Top-level blocks in reading order, column rows replaced by their cells' blocks. */
  function flatten(fragment: Fragment, into: PMNode[]): PMNode[] {
    fragment.forEach((child) => {
      const module = registry.byNodeName.get(child.type.name);
      if (!module) return;
      if (module.wireTypes.some((type) => COLUMN_TYPES.has(type))) flatten(child.content, into);
      else into.push(child);
    });
    return into;
  }

  function serializeBlocks(fragment: Fragment): string {
    let out = '';
    let previousIsItem: boolean | null = null;
    const count = listCounter(0, splitAtStarts);
    for (const node of flatten(fragment, [])) {
      const module = registry.byNodeName.get(node.type.name)!;
      const { number, opensPastOne, splits } = count(node, isNumbered(module.wireTypes));
      const text = module.serialize.toMarkdown(node, contextAt(0, 0, number));
      if (text === '') continue;
      const isItem = module.wireTypes.some((type) => LIST_TYPES.has(type));
      if (previousIsItem !== null && (!(previousIsItem && isItem) || opensPastOne || splits)) out += '\n';
      if (splits) out += RUN_BREAK;
      out += text;
      previousIsItem = isItem;
    }
    // Each module ends its block with one newline, and only that one is trimmed: a block
    // ending in a soft break ends in its hard break marker, newline included, and trimming
    // further would leave a lone backslash a reader takes as literal.
    return out.replace(/\n$/, '');
  }

  return {
    document: (doc) => serializeBlocks(doc.content),
    fragment: (fragment) => serializeBlocks(fragment),
  };
}
