/**
 * Documents to check against, built through the real mapper.
 *
 * Through the mapper rather than by hand-assembling nodes, because the shapes
 * that matter here (an atom folded into prose, a caption, a cell) are exactly
 * the ones a hand-built fixture gets subtly wrong.
 */

import type { Node as PMNode } from 'prosemirror-model';
import { createDocumentMapper } from '../editor/mapper/document';
import { createEditorSchema } from '../editor/schema';
import { defaultTextStyle, type Block, type InlineSpan } from '../model/types';

export const { schema, registry, inline } = createEditorSchema();
export const mapper = createDocumentMapper(schema, registry);

let nextSid = 0;

export function blockOf(over: Partial<Block> = {}): Block {
  nextSid += 1;
  return {
    id: `id-${String(nextSid)}`,
    sid: `s${String(nextSid).padStart(4, '0')}`,
    type: 'Text',
    spans: [{ kind: 'text', text: '', style: { ...defaultTextStyle } }],
    payload: { kind: 'empty' },
    meta: {},
    order: 0,
    children: null,
    ...over,
  };
}

export const text = (value: string): InlineSpan => ({
  kind: 'text',
  text: value,
  style: { ...defaultTextStyle },
});

export const codeText = (value: string): InlineSpan => ({
  kind: 'text',
  text: value,
  style: { ...defaultTextStyle, code: true },
});

export const linkText = (value: string, href: string): InlineSpan => ({
  kind: 'text',
  text: value,
  style: { ...defaultTextStyle, linkUrl: href },
});

export const equation = (latex: string): InlineSpan => ({
  kind: 'equation',
  latex,
  style: { ...defaultTextStyle },
});

export const fraction = (numerator: number, denominator: number): InlineSpan => ({
  kind: 'fraction',
  numerator,
  denominator,
  style: { ...defaultTextStyle },
});

export function docOf(blocks: readonly Block[]): PMNode {
  const result = mapper.toDoc(blocks);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  return result.doc;
}

/** A row of cells, as the three block types a table really is. */
export function tableOf(rows: readonly (readonly string[])[], sidPrefix: string): Block {
  return blockOf({
    type: 'Table',
    sid: `${sidPrefix}-table`,
    payload: {
      kind: 'table',
      columnWidths: rows[0].map(() => 120),
      headerRows: rows.map((_row, index) => index === 0),
      headerColumns: rows[0].map(() => false),
      fullWidth: false,
    },
    children: rows.map((row, r) =>
      blockOf({
        type: 'TableRow',
        sid: `${sidPrefix}-r${String(r)}`,
        order: r,
        children: row.map((value, c) =>
          blockOf({
            type: 'TableCell',
            sid: `${sidPrefix}-c${String(r)}${String(c)}`,
            order: c,
            spans: [text(value)],
            payload: { kind: 'tableCell', fill: '' },
          }),
        ),
      }),
    ),
  });
}
