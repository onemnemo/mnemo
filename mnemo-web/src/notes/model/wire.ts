/**
 * Reads and writes the durable block JSON shared with the .NET side.
 *
 * Notes saved by earlier versions are still on disk, so parsing accepts several
 * historical shapes — `inlineRuns`, a bare `content` string, typed data living
 * in `meta` — and always emits the current canonical one. Parsing must never
 * throw on a real saved note: an unreadable field degrades to its default and
 * the rest of the block survives.
 */

import { normalizeSpans, plainSpan } from './spans';
import {
  defaultTextStyle,
  type Block,
  type BlockPayload,
  type BlockType,
  type InlineSpan,
  type TextStyle,
} from './types';

const blockTypes: BlockType[] = [
  'Text', 'Heading1', 'Heading2', 'Heading3', 'Heading4', 'BulletList',
  'NumberedList', 'Checklist', 'Quote', 'Code', 'Divider', 'Image',
  'ColumnGroup', 'TwoColumn', 'Equation', 'Page', 'Sketch',
];

type Json = Record<string, unknown>;

/** The .NET converter matches property names case-insensitively; saved files rely on it. */
function prop(obj: Json, name: string): unknown {
  if (name in obj) return obj[name];
  const lowered = name.toLowerCase();
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase() === lowered) return obj[key];
  }
  return undefined;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown): boolean {
  return value === true;
}

function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBlockType(value: unknown): BlockType {
  if (typeof value === 'string') {
    const match = blockTypes.find((t) => t.toLowerCase() === value.toLowerCase());
    if (match) return match;
  }
  // Older files stored the enum's ordinal.
  if (typeof value === 'number' && blockTypes[value] !== undefined) return blockTypes[value];
  return 'Text';
}

function parseTextStyle(value: unknown): TextStyle {
  if (!isJson(value)) return { ...defaultTextStyle };
  return {
    bold: bool(prop(value, 'bold')),
    italic: bool(prop(value, 'italic')),
    underline: bool(prop(value, 'underline')),
    strikethrough: bool(prop(value, 'strikethrough')),
    code: bool(prop(value, 'code')),
    highlight: bool(prop(value, 'highlight')),
    backgroundColor: str(prop(value, 'backgroundColor')) || null,
    foregroundColor: str(prop(value, 'foregroundColor')) || null,
    linkUrl: str(prop(value, 'linkUrl')) || null,
    suppressAutoLink: bool(prop(value, 'suppressAutoLink')),
    subscript: bool(prop(value, 'subscript')),
    superscript: bool(prop(value, 'superscript')),
  };
}

function parseSpan(value: Json): InlineSpan {
  const style = parseTextStyle(prop(value, 'style'));
  const kind = str(prop(value, 'kind')).toLowerCase();

  if (kind === 'fraction') {
    const denominator = num(prop(value, 'denominator'), 1);
    return {
      kind: 'fraction',
      numerator: num(prop(value, 'numerator')),
      // A zero or negative denominator is unrenderable; clamp rather than reject the block.
      denominator: denominator > 0 ? denominator : 1,
      style,
    };
  }

  // Some early files wrote equation spans without a `kind`, identifiable only
  // by carrying `latex` and no `text`.
  const looksLikeEquation =
    kind === 'equation' ||
    (kind !== 'text' && prop(value, 'latex') !== undefined && prop(value, 'text') === undefined);

  if (looksLikeEquation) {
    return { kind: 'equation', latex: str(prop(value, 'latex')), style };
  }
  return { kind: 'text', text: str(prop(value, 'text')), style };
}

/** Exported for the C#/TS inline-span differential test, which reuses this parser rather than a second one. */
export function parseSpans(value: unknown): InlineSpan[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isJson).map(parseSpan);
}

function parsePayload(value: unknown): BlockPayload {
  if (!isJson(value)) return { kind: 'empty' };
  switch (str(prop(value, 'kind')).toLowerCase()) {
    case 'equation':
      return { kind: 'equation', latex: str(prop(value, 'latex')) };
    case 'image':
      return {
        kind: 'image',
        path: str(prop(value, 'path')),
        alt: str(prop(value, 'alt')),
        width: num(prop(value, 'width')),
        align: str(prop(value, 'align'), 'left'),
      };
    case 'code':
      return {
        kind: 'code',
        language: str(prop(value, 'language'), 'csharp'),
        source: str(prop(value, 'source')),
      };
    case 'checklist':
      return { kind: 'checklist', checked: bool(prop(value, 'checked')) };
    case 'twocolumn':
      return { kind: 'twoColumn', splitRatio: num(prop(value, 'splitRatio'), 0.5) };
    case 'page':
      return {
        kind: 'page',
        referenceNoteId: str(prop(value, 'referenceNoteId')) || str(prop(value, 'reference_note_id')),
      };
    case 'sketch':
      return { kind: 'sketch', width: num(prop(value, 'width')), align: str(prop(value, 'align'), 'left') };
    default:
      // Unknown kinds included: an unrecognised payload must not lose the block.
      return { kind: 'empty' };
  }
}

/** Before payloads existed, typed data lived in `meta` alongside a plain `content` string. */
function payloadFromLegacyMeta(type: BlockType, meta: Json, legacyContent: string | null): BlockPayload {
  switch (type) {
    case 'Equation':
      return { kind: 'equation', latex: str(prop(meta, 'equationLatex')) };
    case 'Code':
      return { kind: 'code', language: str(prop(meta, 'language')), source: legacyContent ?? '' };
    case 'Image':
      return {
        kind: 'image',
        path: str(prop(meta, 'imagePath')),
        alt: str(prop(meta, 'imageAlt')),
        width: num(prop(meta, 'imageWidth')),
        align: str(prop(meta, 'imageAlign'), 'left'),
      };
    case 'Checklist':
      return { kind: 'checklist', checked: bool(prop(meta, 'checked')) };
    case 'TwoColumn': {
      const ratio = num(prop(meta, 'columnSplitRatio'), 0.5);
      return { kind: 'twoColumn', splitRatio: ratio > 0 && ratio < 1 ? ratio : 0.5 };
    }
    case 'Page':
      return { kind: 'page', referenceNoteId: str(prop(meta, 'reference_note_id')) };
    default:
      return { kind: 'empty' };
  }
}

export function parseBlock(value: unknown): Block {
  const raw: Json = isJson(value) ? value : {};

  const type = parseBlockType(prop(raw, 'type'));
  const metaValue = prop(raw, 'meta');
  const meta: Json = isJson(metaValue) ? { ...metaValue } : {};
  const contentValue = prop(raw, 'content');
  const legacyContent = typeof contentValue === 'string' ? contentValue : null;

  const payloadValue = prop(raw, 'payload');
  const payload =
    payloadValue !== undefined ? parsePayload(payloadValue) : payloadFromLegacyMeta(type, meta, legacyContent);

  let spans = parseSpans(prop(raw, 'spans'));
  if (spans.length === 0) {
    const runs = prop(raw, 'inlineRuns');
    if (Array.isArray(runs)) spans = parseSpans(runs);
    else if (legacyContent !== null) spans = [plainSpan(legacyContent)];
  }

  // A code block that only ever had its text in the payload still needs spans
  // to be editable.
  if (type === 'Code' && payload.kind === 'code' && payload.source.length > 0) {
    const empty = spans.every((s) => s.kind === 'text' && s.text.trim().length === 0);
    if (empty) spans = [plainSpan(payload.source)];
  }

  // Equation and page blocks render entirely from their payload; carrying stale
  // spans would put an editable caret inside content nothing reads.
  if (type === 'Equation' || type === 'Page') spans = [plainSpan('')];

  const children = prop(raw, 'children');

  return {
    id: str(prop(raw, 'id')) || crypto.randomUUID(),
    type,
    spans: normalizeSpans(spans),
    payload,
    meta,
    order: num(prop(raw, 'order')),
    children: Array.isArray(children) ? children.map(parseBlock) : null,
  };
}

export function parseBlocks(value: unknown): Block[] {
  return Array.isArray(value) ? value.map(parseBlock) : [];
}

function serializeStyle(style: TextStyle): Json {
  const out: Json = {
    bold: style.bold,
    italic: style.italic,
    underline: style.underline,
    strikethrough: style.strikethrough,
    code: style.code,
    highlight: style.highlight,
  };
  if (style.backgroundColor !== null) out.backgroundColor = style.backgroundColor;
  if (style.foregroundColor !== null) out.foregroundColor = style.foregroundColor;
  if (style.linkUrl !== null) out.linkUrl = style.linkUrl;
  out.suppressAutoLink = style.suppressAutoLink;
  if (style.subscript) out.subscript = true;
  if (style.superscript) out.superscript = true;
  return out;
}

function serializeSpan(span: InlineSpan): Json {
  switch (span.kind) {
    case 'text':
      return { kind: 'text', text: span.text, style: serializeStyle(span.style) };
    case 'equation':
      return { kind: 'equation', latex: span.latex, style: serializeStyle(span.style) };
    case 'fraction':
      return {
        kind: 'fraction',
        numerator: span.numerator,
        denominator: span.denominator,
        style: serializeStyle(span.style),
      };
  }
}

export function serializeBlock(block: Block): Json {
  const out: Json = {
    id: block.id,
    type: block.type,
    spans: block.spans.map(serializeSpan),
    payload: { ...block.payload },
    meta: block.meta,
    order: block.order,
  };
  if (block.children !== null) out.children = block.children.map(serializeBlock);
  return out;
}

export function serializeBlocks(blocks: readonly Block[]): Json[] {
  return blocks.map(serializeBlock);
}
