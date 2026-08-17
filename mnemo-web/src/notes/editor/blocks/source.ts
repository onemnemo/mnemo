/**
 * The two blocks whose content is source rather than prose: code and sketch.
 *
 * Both use `codeLine`, whose `marks: ""` forbids every mark structurally. That
 * replaces the scattered `if (type != Code)` guards on the C# side, and it fixes
 * a live bug on the sketch side, where autolink exempts only code today and a
 * URL-shaped token in a sketch DSL gets link-styled.
 */

import type { AiSegment, AnyBlockModule } from '../registry/types';
import type { Block, BlockType, InlineSpan } from '../../model/types';
import { plainSpan } from '../../model/spans';
import { defineBlock, lineText, metrics, type BlockDeps } from './shared';
import { convertHere } from './slash-insert';
import { codeBlockView, CODE_FOLD_AT } from '../code/code-block-view';

/**
 * A code block stores its source in both `spans[0].text` and `payload.source`.
 *
 * Here the payload genuinely is authoritative, the C# reader treats it that
 * way, and unlike an image caption it is safe to trust on read, because a
 * `codeLine` forbids marks structurally so there is no styling for the plain
 * text to lose. Falling back to the spans when the payload is empty keeps the
 * text of a block whose two copies ever disagreed, and since the fallback
 * writes the payload on the way out, the next cycle is stable.
 */
function sourceSpans(source: string, spans: readonly InlineSpan[]): readonly InlineSpan[] {
  return source.length > 0 ? [plainSpan(source)] : spans;
}

export function codeBlock(deps: BlockDeps): AnyBlockModule {
  return defineBlock<{ language: string; wrap: boolean; numbers: boolean; caption: string }>(
    {
      nodeName: 'codeBlock',
      wireTypes: ['Code'],
      lineKind: 'codeLine',
      attrs: {
        language: { default: 'csharp' },
        // Display choices, not content. They ride the node so undo restores them
        // with the rest of the block and the autosave carries them out.
        wrap: { default: false },
        numbers: { default: false },
        caption: { default: '' },
      },
      nodeOptions: {
        // `defining` keeps the block itself alive when its content is replaced,
        // so pasting into a code block does not silently turn it into a
        // paragraph and lose the language.
        defining: true,
        parseDOM: [
          {
            tag: 'pre',
            preserveWhitespace: 'full',
            getAttrs: (n) => ({
              language: (n as HTMLElement).getAttribute('data-language') ?? 'csharp',
            }),
          },
        ],
        toDOM: (node) => ['pre', { 'data-language': String(node.attrs.language) }, ['code', 0]],
      },
      attrsFrom: (block) => ({
        language: block.payload.kind === 'code' ? block.payload.language : 'csharp',
        wrap: block.payload.kind === 'code' && block.payload.wrap === true,
        numbers: block.payload.kind === 'code' && block.payload.numbers === true,
        caption: block.payload.kind === 'code' ? (block.payload.caption ?? '') : '',
      }),
      spansFor: (block: Block) =>
        sourceSpans(block.payload.kind === 'code' ? block.payload.source : '', block.spans),
      wireFrom: (node) => ({
        type: 'Code' as BlockType,
        payload: {
          kind: 'code' as const,
          language: String(node.attrs.language ?? 'csharp'),
          source: lineText(node),
          wrap: node.attrs.wrap === true,
          numbers: node.attrs.numbers === true,
          caption: String(node.attrs.caption ?? ''),
        },
      }),
      toMarkdown: (node) =>
        `\`\`\`${String(node.attrs.language ?? '')}\n${lineText(node)}\n\`\`\`\n`,
      segmentsFor: (_node, text): readonly AiSegment[] =>
        text.length > 0 ? [{ kind: 'code', text, offset: 0 }] : [],
      realizedView: codeBlockView,
      estimate: (_node, _ctx, text) => {
        // Source does not wrap in the editor unless it is asked to; it scrolls.
        // Line count is then the whole story, and available width does not enter
        // into it. A wrapped block is guessed at rather than measured, because
        // the estimate exists precisely for blocks nothing has measured.
        const lines = text.length === 0 ? 1 : text.split('\n').length;
        // A folded block draws a screen of code and a button, however long it is.
        const shown = Math.min(lines, CODE_FOLD_AT + 1);
        return shown * metrics.bodyLineHeight + metrics.blockPaddingY * 2;
      },
      slash: [
        {
          label: 'Code',
          description: 'CodeDescription',
          icon: 'notes/code',
          hint: '```',
          group: 'insert',
          insert: convertHere('codeBlock'),
        },
      ],
    },
    deps,
  );
}

export function sketchBlock(deps: BlockDeps): AnyBlockModule {
  return defineBlock<{ width: number; align: string }>(
    {
      nodeName: 'sketch',
      wireTypes: ['Sketch'],
      lineKind: 'codeLine',
      attrs: { width: { default: 0 }, align: { default: 'left' } },
      nodeOptions: {
        defining: true,
        parseDOM: [{ tag: 'div[data-sketch]', preserveWhitespace: 'full' }],
        toDOM: () => ['div', { 'data-sketch': '' }, 0],
      },
      attrsFrom: (block) => ({
        width: block.payload.kind === 'sketch' ? block.payload.width : 0,
        align: block.payload.kind === 'sketch' ? block.payload.align : 'left',
      }),
      wireFrom: (node) => ({
        type: 'Sketch' as BlockType,
        payload: {
          kind: 'sketch' as const,
          width: Number(node.attrs.width) || 0,
          align: String(node.attrs.align ?? 'left'),
        },
      }),
      // The DSL is the block's text, not a payload field, so it round-trips
      // through the line like any other content, `\r\n` endings included, which
      // real sketch data has and nothing on this path normalizes.
      toMarkdown: (node) => `\`\`\`mnemo-sketch\n${lineText(node)}\n\`\`\`\n`,
      segmentsFor: (_node, text): readonly AiSegment[] =>
        text.length > 0 ? [{ kind: 'code', text, offset: 0 }] : [],
      // A rendered sketch's height is a property of the drawing, which nothing
      // here can see. A fixed guess is honest; realization corrects it.
      estimate: (node) => (Number(node.attrs.width) > 0 ? 240 : 180),
    },
    deps,
  );
}
