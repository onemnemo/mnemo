/**
 * Documents to check against, built through the real mapper, and the status
 * shapes the host answers with.
 *
 * Through the mapper rather than by hand-assembling nodes, because the shapes
 * that matter here (an atom folded into prose, a caption, a cell) are exactly
 * the ones a hand-built fixture gets subtly wrong.
 */

import type { Node as PMNode } from 'prosemirror-model';
import { createDocumentMapper } from '../editor/mapper/document';
import type { LocatedIssue, ProofingIssue } from './proofing-plugin';
import { checkableSegments, resolveRange } from './segments';
import { createEditorSchema } from '../editor/schema';
import { defaultTextStyle, type Block, type InlineSpan } from '../model/types';
import type { ProofingLanguage, ProofingLanguageState, ProofingStatus } from './types';

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

export const boldText = (value: string): InlineSpan => ({
  kind: 'text',
  text: value,
  style: { ...defaultTextStyle, bold: true },
});

export const italicText = (value: string): InlineSpan => ({
  kind: 'text',
  text: value,
  style: { ...defaultTextStyle, italic: true },
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

/** A catalogue entry. Everything but `absent` counts as installed. */
export function proofingLanguage(id: string, state: ProofingLanguageState): ProofingLanguage {
  return {
    id,
    name: id,
    region: '',
    installed: state !== 'absent',
    bundled: state !== 'absent',
    state,
    license: { name: 'SCOWL', url: 'https://example.com' },
  };
}

/**
 * A status over the two bundled dictionaries, one read and one still reading,
 * which is the state the client has to keep working in.
 */
export function proofingStatusOf(
  active: readonly string[],
  over: Partial<ProofingStatus> = {},
): ProofingStatus {
  return {
    enabled: true,
    active,
    languages: [
      proofingLanguage('en-US', 'ready'),
      proofingLanguage('es-ES', 'loading'),
      proofingLanguage('de-DE', 'absent'),
    ],
    personalWordCount: 0,
    ...over,
  };
}

/** Every segment id the document currently has, as an answer meta carries them. */
export function liveSegmentIds(doc: PMNode): string[] {
  return checkableSegments(doc, registry).map((segment) => segment.id);
}

/** The answer a stubbed check would give for one word, already located. */
export function locatedIssueFor(
  doc: PMNode,
  sid: string,
  word: string,
  over: Partial<ProofingIssue> = {},
): LocatedIssue {
  const segment = checkableSegments(doc, registry).find((entry) => entry.sid === sid);
  if (!segment) throw new Error(`no segment for ${sid}`);
  const start = segment.text.indexOf(word);
  if (start < 0) throw new Error(`"${word}" is not in ${sid}`);
  const range = resolveRange(doc, segment, start, start + word.length, word);
  if (!range) throw new Error(`could not resolve "${word}"`);
  return {
    from: range.from,
    to: range.to,
    issue: {
      segmentId: segment.id,
      text: word,
      kind: 'spelling',
      tone: 'error',
      segmentText: segment.text,
      segmentStart: start,
      segmentEnd: start + word.length,
      ...over,
    },
  };
}
