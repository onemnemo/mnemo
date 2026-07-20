/**
 * The three block types the product treats as atomic: divider, block equation
 * and page reference.
 *
 * They still carry a line, and they still accept block children. Every `Block`
 * on the wire has `spans` and a nullable `children`, and a schema that refuses
 * to hold either is a schema that drops them — worse, it rejects the whole
 * document, so one stray child on one divider would quarantine an entire note
 * the user could otherwise read. Nothing creates these shapes; the schema
 * simply declines to be the reason a note fails to open.
 *
 * Making these behave atomically to the caret is a NodeView and command
 * concern, not a persistence one.
 */

import type { AnyBlockModule } from '../registry/types';
import type { BlockType } from '../../model/types';
import { plainSpan } from '../../model/spans';
import { defineBlock, metrics, type BlockDeps } from './shared';

/** Spans that the C# converter force-clears, so nothing renders behind the payload. */
const noSpans = () => [plainSpan('')];

export function dividerBlock(deps: BlockDeps): AnyBlockModule {
  return defineBlock(
    {
      nodeName: 'divider',
      wireTypes: ['Divider'],
      nodeOptions: { parseDOM: [{ tag: 'hr' }], toDOM: () => ['hr'] },
      attrsFrom: () => ({}),
      wireFrom: () => ({ type: 'Divider' as BlockType, payload: { kind: 'empty' as const } }),
      toMarkdown: () => '---\n',
      estimate: () => metrics.bodyLineHeight,
    },
    deps,
  );
}

export function equationBlockModule(deps: BlockDeps): AnyBlockModule {
  return defineBlock<{ latex: string }>(
    {
      nodeName: 'equationBlock',
      wireTypes: ['Equation'],
      attrs: { latex: { default: '' } },
      nodeOptions: {
        parseDOM: [
          {
            tag: 'div[data-equation-block]',
            getAttrs: (n) => ({
              latex: (n as HTMLElement).getAttribute('data-equation-block') ?? '',
            }),
          },
        ],
        toDOM: (node) => ['div', { 'data-equation-block': String(node.attrs.latex) }],
      },
      attrsFrom: (block) => ({
        latex: block.payload.kind === 'equation' ? block.payload.latex : '',
      }),
      // Spans are force-cleared: an equation renders entirely from its payload,
      // and carrying stale spans would put an editable caret inside content
      // nothing reads.
      spansFor: noSpans,
      wireFrom: (node) => ({
        type: 'Equation' as BlockType,
        payload: { kind: 'equation' as const, latex: String(node.attrs.latex ?? '') },
      }),
      toMarkdown: (node) => `$$\n${String(node.attrs.latex ?? '')}\n$$\n`,
      segmentsFor: (node) => {
        const latex = String(node.attrs.latex ?? '');
        return latex.length > 0 ? [{ kind: 'equation' as const, text: latex, offset: 0 }] : [];
      },
      estimate: () => 64,
    },
    deps,
  );
}

/**
 * A navigation card, not a transclusion. The referenced note's **title is never
 * copied into the document** — it is resolved from the note store at render.
 * Storing it would mean every rename dirties every note that links to it, and
 * autosave would churn on a field the user never edited.
 */
export function pageBlock(deps: BlockDeps): AnyBlockModule {
  return defineBlock<{ referenceNoteId: string }>(
    {
      nodeName: 'page',
      wireTypes: ['Page'],
      attrs: { referenceNoteId: { default: '' } },
      nodeOptions: {
        parseDOM: [
          {
            tag: 'a[data-page-ref]',
            getAttrs: (n) => ({
              referenceNoteId: (n as HTMLElement).getAttribute('data-page-ref') ?? '',
            }),
          },
        ],
        toDOM: (node) => ['a', { 'data-page-ref': String(node.attrs.referenceNoteId) }],
      },
      attrsFrom: (block) => ({
        referenceNoteId: block.payload.kind === 'page' ? block.payload.referenceNoteId : '',
      }),
      spansFor: noSpans,
      wireFrom: (node) => ({
        type: 'Page' as BlockType,
        payload: {
          kind: 'page' as const,
          referenceNoteId: String(node.attrs.referenceNoteId ?? ''),
        },
      }),
      // The title is not available here, and inventing one would put a stale
      // copy in an exported file. The id is the durable fact.
      toMarkdown: (node) => `[[${String(node.attrs.referenceNoteId ?? '')}]]\n`,
      // No projection: the only text a page card shows belongs to another note,
      // and emitting it here would give find two hits for one string.
      segmentsFor: () => [],
      estimate: () => 56,
    },
    deps,
  );
}
