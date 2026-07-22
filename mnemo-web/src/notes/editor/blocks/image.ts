/**
 * The image block.
 *
 * Its caption lives in the line, which is the concrete payoff of the mandatory
 * line, since the image was originally specified as a childless atom and eight
 * of the nine real image blocks carry caption text in `spans[0].text`. As an
 * atom that text had nowhere to go.
 *
 * The caption is also stored in `payload.alt`, byte-identical in every real
 * block. That redundancy is why the projection emits one segment and not two:
 * a caption yielding both a `prose` and an `imageAlt` hit would make find
 * return two results for one string, one of which has no editable location.
 *
 * `width` and `align` must be part of whatever change signal drives autosave.
 * They are the fields a drag-resize writes, and they are why the persisted
 * hash covers attrs rather than text alone.
 */

import type { AiSegment, AnyBlockModule } from '../registry/types';
import type { Block, BlockType, InlineSpan } from '../../model/types';
import { plainSpan } from '../../model/spans';
import { defineBlock, lineText, type BlockDeps } from './shared';

/**
 * For an image, **the line is authoritative and `alt` is derived**, the exact
 * opposite of the code block, and the difference matters.
 *
 * `payload.source` on a code block is a genuinely stored field: the C# reader
 * treats it as the truth and the block's text is the copy. `payload.alt` is not.
 * It is written *from* the caption on the way out, so trusting it on the way in
 * closes a feedback loop: the caption produces a plain-text `alt`, and the next
 * load rebuilds the caption from that `alt` as a single unstyled span.
 *
 * A property fixture caught this and it was a real data-loss bug, an italic or
 * linked caption, or one containing an inline equation, survived the first save
 * and was silently flattened by the second. Exactly the "changes once and then
 * stops" class the three-cycle harness exists to find, and invisible to any
 * single round trip.
 *
 * `alt` still wins when the line has nothing in it, which is the legacy case:
 * older data set `alt` without ever writing caption spans.
 */
function captionSpans(alt: string, spans: readonly InlineSpan[]): readonly InlineSpan[] {
  const hasContent = spans.some((s) => s.kind !== 'text' || s.text.length > 0);
  if (hasContent) return spans;
  return alt.length > 0 ? [plainSpan(alt)] : spans;
}

export function imageBlock(deps: BlockDeps): AnyBlockModule {
  return defineBlock<{ path: string; alt: string; width: number; align: string }>(
    {
      nodeName: 'image',
      wireTypes: ['Image'],
      attrs: {
        path: { default: '' },
        alt: { default: '' },
        width: { default: 0 },
        align: { default: 'left' },
      },
      nodeOptions: {
        parseDOM: [
          {
            tag: 'img[src]',
            getAttrs: (n) => {
              const el = n as HTMLElement;
              return {
                path: el.getAttribute('src') ?? '',
                alt: el.getAttribute('alt') ?? '',
                width: Number(el.getAttribute('width')) || 0,
                align: el.getAttribute('data-align') ?? 'left',
              };
            },
          },
        ],
        // `path` is a stored reference, not a URL, real data holds both
        // `attachment:` references and absolute paths. Resolving it belongs to
        // the realized view, which has the services handle; a raw `src` here
        // would simply fail to load.
        toDOM: (node) => [
          'figure',
          { 'data-image': String(node.attrs.path), 'data-align': String(node.attrs.align) },
          0,
        ],
      },
      attrsFrom: (block) => ({
        path: block.payload.kind === 'image' ? block.payload.path : '',
        alt: block.payload.kind === 'image' ? block.payload.alt : '',
        width: block.payload.kind === 'image' ? block.payload.width : 0,
        align: block.payload.kind === 'image' ? block.payload.align : 'left',
      }),
      spansFor: (block: Block) =>
        captionSpans(block.payload.kind === 'image' ? block.payload.alt : '', block.spans),
      wireFrom: (node) => ({
        type: 'Image' as BlockType,
        payload: {
          kind: 'image' as const,
          path: String(node.attrs.path ?? ''),
          // Written from the line, so the two copies cannot drift apart once a
          // block has been through here.
          alt: lineText(node),
          width: Number(node.attrs.width) || 0,
          align: String(node.attrs.align ?? 'left'),
        },
      }),
      toMarkdown: (node, ctx, inline) =>
        `![${ctx.escapeText(inline)}](${String(node.attrs.path ?? '')})\n`,
      segmentsFor: (_node, text): readonly AiSegment[] =>
        text.length > 0 ? [{ kind: 'imageAlt', text, offset: 0 }] : [],
      estimate: (node, ctx) => {
        const width = Number(node.attrs.width) || ctx.availableWidth;
        // No stored aspect ratio, so assume a common one. The measured height
        // replaces this as soon as the image realizes and decodes.
        return Math.round(Math.min(width, ctx.availableWidth) * 0.66) + 32;
      },
    },
    deps,
  );
}
