/**
 * Document/fragment -> markdown: the driver the block modules were written
 * against but that nothing constructed until now.
 *
 * Each block module already knows how to render itself (`serialize.toMarkdown`),
 * but a module deliberately cannot reach into its own children or inline content
 * (see `MdContext`), because a nested block belongs to a different module and an
 * inline run belongs to the span serializer. This supplies those three
 * capabilities so a whole document can be walked: `serializeChildren` recurses
 * through the registry, `serializeInline` reuses the real inline mapper so a
 * copied caption reads exactly as a saved one, and `escapeText` guards literal
 * text.
 *
 * Containers flatten: a two-column row has no markdown form, so its markdown is
 * just its cells' blocks in document order, matching the desktop, whose
 * markdown/plain-text path likewise loses the column layout while the exact
 * clipboard path keeps it.
 */

import type { Fragment, Node as PMNode } from 'prosemirror-model';

import type { BlockRegistry } from '../registry/build';
import type { MdContext } from '../registry/types';
import type { InlineMapper } from './inline';
import { escapeMarkdownText, serializeInlineMarkdown } from '../../model/markdown-serialize';

export interface MarkdownSerializer {
  /** The whole document as markdown, with no trailing blank line. */
  document(doc: PMNode): string;
  /** A fragment of whole top-level blocks, e.g. the content of a copied slice. */
  fragment(fragment: Fragment): string;
}

export function createMarkdownSerializer(
  registry: BlockRegistry,
  inline: InlineMapper,
): MarkdownSerializer {
  function serializeInline(line: PMNode): string {
    return serializeInlineMarkdown(inline.fromInline(line));
  }

  function contextAt(depth: number): MdContext {
    return {
      depth,
      serializeChildren: (node) => serializeFragment(node.content, depth + 1),
      serializeInline,
      escapeText: escapeMarkdownText,
    };
  }

  function serializeFragment(fragment: Fragment, depth: number): string {
    let out = '';
    fragment.forEach((child) => {
      const module = registry.byNodeName.get(child.type.name);
      // A `line`/`codeLine` child is inline content, not a block, and is never
      // in the registry; the block modules render their own line through
      // `serializeInline`, so skipping it here is correct, not a gap.
      if (!module) return;
      out += module.serialize.toMarkdown(child, contextAt(depth));
    });
    return out;
  }

  return {
    // Each module ends its block with a single newline, so the join is one line
    // per block; the trailing one is trimmed to match the desktop serializer.
    document: (doc) => serializeFragment(doc.content, 0).replace(/\n+$/, ''),
    fragment: (fragment) => serializeFragment(fragment, 0).replace(/\n+$/, ''),
  };
}
