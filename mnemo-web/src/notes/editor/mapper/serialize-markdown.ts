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

const LIST_TYPES: ReadonlySet<BlockType> = new Set<BlockType>(['BulletList', 'NumberedList', 'Checklist']);
const COLUMN_TYPES: ReadonlySet<BlockType> = new Set<BlockType>(['TwoColumn', 'ColumnGroup']);

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
}

export function createMarkdownSerializer(
  registry: BlockRegistry,
  inline: InlineMapper,
  options: MarkdownSerializerOptions = {},
): MarkdownSerializer {
  const emptyParagraph = options.emptyParagraph ?? 'nbsp';

  function serializeInline(line: PMNode): string {
    return serializeInlineMarkdown(inline.fromInline(line));
  }

  function contextAt(depth: number): MdContext {
    return {
      depth,
      serializeChildren: (node) => serializeFragment(node.content, depth + 1),
      serializeInline,
      escapeText: escapeMarkdownText,
      emptyParagraph,
    };
  }

  function serializeFragment(fragment: Fragment, depth: number): string {
    let out = '';
    fragment.forEach((child) => {
      const module = registry.byNodeName.get(child.type.name);
      // A `line`/`codeLine` child is inline content, not a block, and is never in the
      // registry; each module renders its own line through `serializeInline`.
      if (!module) return;
      out += module.serialize.toMarkdown(child, contextAt(depth));
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
    for (const node of flatten(fragment, [])) {
      const module = registry.byNodeName.get(node.type.name)!;
      const text = module.serialize.toMarkdown(node, contextAt(0));
      if (text === '') continue;
      const isItem = module.wireTypes.some((type) => LIST_TYPES.has(type));
      if (previousIsItem !== null && !(previousIsItem && isItem)) out += '\n';
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
