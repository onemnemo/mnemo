/**
 * Reads and writes the durable block JSON shared with the .NET side.
 *
 * Notes saved by earlier versions are still on disk, so parsing accepts several
 * historical shapes, `inlineRuns`, a bare `content` string, typed data living
 * in `meta`, and always emits the current canonical one. Parsing must never
 * throw on a real saved note: an unreadable field degrades to its default and
 * the rest of the block survives.
 */

import { readCrop } from './image-crop';
import { normalizeSpans, plainSpan } from './spans';
import {
  allBlockTypes,
  defaultTextStyle,
  type Block,
  type BlockPayload,
  type BlockType,
  type InlineSpan,
  type TextStyle,
} from './types';

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

/** A numeric array, dropping anything in it that is not a finite number. */
function numbers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
}

/** A boolean array; any non-`true` entry reads as false, so the shape is total. */
function bools(value: unknown): boolean[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => item === true);
}

/**
 * The header arrays a table stored, reading the legacy pair when the arrays are
 * absent. Older tables carried a single `headerRow` / `headerCol` boolean that
 * meant "the first one is a header", so a true legacy flag becomes a header in
 * position 0 and everything downstream sees only the array form.
 */
function tableHeaders(value: Json): { headerRows: boolean[]; headerColumns: boolean[] } {
  const rows = prop(value, 'headerRows');
  const cols = prop(value, 'headerColumns');
  return {
    headerRows: rows === undefined ? (bool(prop(value, 'headerRow')) ? [true] : []) : bools(rows),
    headerColumns: cols === undefined ? (bool(prop(value, 'headerCol')) ? [true] : []) : bools(cols),
  };
}

function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A type token this build does not know is carried through, not coerced to `Text`.
 *
 * Coercing made the block invisible: the mapper's unknown-type quarantine could
 * never fire from real saved bytes, so a note written by a newer version opened
 * as a page of paragraphs and the first autosave wrote that back over the
 * original. Carrying the token means the mapper refuses the document and the
 * note is left exactly as it was found.
 */
function parseBlockType(value: unknown): BlockType {
  if (typeof value === 'string' && value.length > 0) {
    const match = allBlockTypes.find((t) => t.toLowerCase() === value.toLowerCase());
    return match ?? (value as BlockType);
  }
  // Older files stored the enum's ordinal.
  if (typeof value === 'number' && allBlockTypes[value] !== undefined) return allBlockTypes[value];
  return 'Text';
}

/**
 * Themed colors that earlier builds wrote *instead of* a highlight flag.
 *
 * A build before `Highlight` existed persisted a highlight as nothing but one
 * of these background colors, so reading them literally turns a highlight into
 * a background swatch. That matters more here than it would in C#: the port
 * models background as a design *token* (`"swatch5"`), so a raw hex fed through
 * as if it were a token is not merely the wrong shade, it is not a token at all.
 */
const legacyHighlightColors = new Set(['#ffd7aa', '#5b3717', '#ffff00']);

/**
 * Applied when reading a stored *note*, not inside the span parser.
 *
 * C# promotes inside `ReadTextStyle`, which amounts to the same thing for a
 * saved note. It cannot go there here because `parseSpans` is also what the
 * cross-language differential uses to rebuild in-memory span state from its
 * frozen fixture, and that fixture's palette contains `#FFD7AA` as an ordinary
 * background color. Promoting in the parser rewrites the differential's inputs
 * and it starts disagreeing with C# about operations that have nothing to do
 * with legacy data, which is exactly how this was caught.
 */
function promoteLegacyHighlight(spans: InlineSpan[]): InlineSpan[] {
  return spans.map((span) => {
    const bg = span.style.backgroundColor;
    if (span.style.highlight || bg === null || !legacyHighlightColors.has(bg.toLowerCase())) {
      return span;
    }
    return { ...span, style: { ...span.style, highlight: true, backgroundColor: null } };
  });
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
        // Last, because the serializer spreads this object and the C# writer emits
        // crop after align. The two have to produce the same bytes for one block.
        crop: readCrop(prop(value, 'crop')),
      };
    case 'code':
      return {
        kind: 'code',
        language: str(prop(value, 'language'), 'csharp'),
        source: str(prop(value, 'source')),
        wrap: bool(prop(value, 'wrap')),
        numbers: bool(prop(value, 'numbers')),
        caption: str(prop(value, 'caption')),
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
    case 'callout':
      return { kind: 'callout', emoji: str(prop(value, 'emoji')), tone: str(prop(value, 'tone'), 'note') };
    case 'table':
      return {
        kind: 'table',
        columnWidths: numbers(prop(value, 'columnWidths')),
        ...tableHeaders(value),
        fullWidth: bool(prop(value, 'fullWidth')),
      };
    case 'tablecell':
      return { kind: 'tableCell', fill: str(prop(value, 'fill')) };
    default: {
      // Carried through for the same reason as an unknown block type. Reading it
      // as `empty` let the editor open the block and save that emptiness back
      // over a payload it simply could not decode; keeping the kind makes the
      // normalizer report a mismatch and hold the note instead.
      const kind = str(prop(value, 'kind'));
      return kind === '' ? { kind: 'empty' } : unknownPayload(kind);
    }
  }
}

/**
 * A stand-in for a payload kind this build has no reader for. It carries only the
 * kind: the fields belong to a shape nothing here can describe, and the note is
 * held rather than edited, so there is nothing that would put them back.
 */
function unknownPayload(kind: string): BlockPayload {
  return { kind } as BlockPayload;
}

/**
 * Mirrors `NormalizeSplitRatio`. Applied **only** on the legacy meta path, a
 * ratio stored in the payload is read verbatim on both sides, so normalizing it
 * here would rewrite ratios the user set deliberately.
 */
function normalizeSplitRatio(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0 || raw >= 1) return 0.5;
  return Math.min(0.9, Math.max(0.1, raw));
}

/** Before payloads existed, typed data lived in `meta` alongside a plain `content` string. */
function payloadFromLegacyMeta(type: BlockType, meta: Json, legacyContent: string | null): BlockPayload {
  switch (type) {
    case 'Equation':
      return { kind: 'equation', latex: str(prop(meta, 'equationLatex')) };
    case 'Code':
      // The display fields are left absent rather than defaulted: they postdate
      // this shape entirely, so a note this old has no opinion to record.
      return { kind: 'code', language: str(prop(meta, 'language')), source: legacyContent ?? '' };
    case 'Image':
      return {
        kind: 'image',
        path: str(prop(meta, 'imagePath')),
        alt: str(prop(meta, 'imageAlt')),
        width: num(prop(meta, 'imageWidth')),
        align: str(prop(meta, 'imageAlign'), 'left'),
        // Nothing stored this way has one: the meta shape predates the field entirely.
        crop: null,
      };
    case 'Checklist':
      return { kind: 'checklist', checked: bool(prop(meta, 'checked')) };
    case 'TwoColumn':
      return { kind: 'twoColumn', splitRatio: normalizeSplitRatio(num(prop(meta, 'columnSplitRatio'))) };
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

  // A present `spans` array is authoritative even when empty, C#'s reader
  // returns one blank span for it and never consults the legacy fields. Falling
  // back on an empty array would resurrect `content` on a block whose text the
  // user had deliberately cleared.
  const spansValue = prop(raw, 'spans');
  let spans = parseSpans(spansValue);
  if (spans.length === 0 && !Array.isArray(spansValue)) {
    const runs = prop(raw, 'inlineRuns');
    if (Array.isArray(runs)) spans = parseSpans(runs);
    else if (legacyContent !== null) spans = [plainSpan(legacyContent)];
  }

  // A code block that only ever had its text in the payload still needs spans
  // to be editable.
  if (type === 'Code' && payload.kind === 'code' && payload.source.length > 0) {
    // Blank means the block's *displayed* text is blank, which is how C# asks
    // the question. Testing only text spans would call a block holding one
    // empty-latex equation non-blank and skip a backfill the other side does.
    const displayed = spans
      .map((s) => (s.kind === 'text' ? s.text : s.kind === 'equation' ? s.latex : 'x'))
      .join('');
    if (displayed.trim().length === 0) spans = [plainSpan(payload.source)];
  }

  // Equation and page blocks render entirely from their payload; carrying stale
  // spans would put an editable caret inside content nothing reads.
  if (type === 'Equation' || type === 'Page') spans = [plainSpan('')];

  const children = prop(raw, 'children');

  return {
    id: str(prop(raw, 'id')) || crypto.randomUUID(),
    // Deliberately not minted here the way `id` is: sids must be unique within
    // the note, which only the server can check. Empty is the correct way to
    // tell it this block is new.
    sid: str(prop(raw, 'sid')),
    type,
    spans: normalizeSpans(promoteLegacyHighlight(spans)),
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

/**
 * The object-replacement and interlinear-annotation characters.
 *
 * These are an artifact of Avalonia's flat-string editing model, where inline
 * atoms had to occupy a character position so caret arithmetic worked. The port
 * has no equivalent: ProseMirror positions *are* the logical space, so nothing
 * here ever needs a placeholder character.
 *
 * That makes their appearance in persisted text a certain bug, either a paste
 * carrying them in from the old editor, or a mapper writing an atom as text.
 * Both silently corrupt the note, and both are invisible in the UI, so this
 * fails loudly in development rather than saving the damage.
 */
const sentinelChars = /[￼￹￺￻]/;

function assertNoSentinels(text: string): void {
  if (import.meta.env.DEV && sentinelChars.test(text)) {
    // Loud, but not fatal. This could justifiably throw, on the reasoning
    // that these characters can only come from a flattened atom. They can also
    // come from an ordinary paste, U+FFFC is what Word,
    // PDF viewers and browsers put in the clipboard for an embedded object, and
    // this runs on the *writer*, so throwing would leave the user holding a note
    // they cannot save, over content they legitimately pasted. Sanitizing
    // belongs at the paste boundary; this stays a tripwire.
    console.error(
      'persisting a text span containing an inline placeholder character ' +
        '(U+FFFC/U+FFF9-FFFB). Expected from a paste; if it came from the mapper, ' +
        'an atom was flattened into text.',
      { text },
    );
  }
}

function serializeSpan(span: InlineSpan): Json {
  switch (span.kind) {
    case 'text':
      assertNoSentinels(span.text);
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

/**
 * Meta keys that are now typed payload fields, per block type.
 *
 * Legacy notes stored these in the passthrough bag. Parsing promotes them into
 * the payload, so writing them back out as well would store the same value
 * twice, and once the user edits the block, the two copies disagree and the
 * stale one is the more convincing. `BlockJsonConverter` drops them on write for
 * the same reason; this is the parity fix that keeps the two writers producing
 * the same bytes for the same block.
 */
const shadowMetaKeys: Partial<Record<BlockType, readonly string[]>> = {
  TwoColumn: ['columnSplitRatio'],
  Page: ['reference_note_id'],
  Image: ['imagePath', 'imageAlt', 'imageWidth', 'imageAlign'],
};

function serializeMeta(block: Block): Json {
  const shadowed = shadowMetaKeys[block.type];
  if (!shadowed) return block.meta;
  const meta: Json = { ...block.meta };
  for (const key of shadowed) delete meta[key];
  return meta;
}

/**
 * Rescues a legacy value out of `meta` before the key is stripped.
 *
 * Stripping without this loses data outright: a block whose payload never got
 * built from its meta, because it was constructed in code rather than parsed,
 * would have the meta key removed and nothing written in its place. The C#
 * writer does the same backfill immediately before the same strip, and the two
 * have to agree or the note changes depending on which side saved it.
 *
 * Image is deliberately absent. The C# writer strips its four meta keys without
 * a backfill, and that is safe on both sides because the *reader* always builds
 * an image payload from them, so a parsed block never reaches here empty.
 */
function backfillPayload(block: Block): BlockPayload {
  if (block.payload.kind !== 'empty') return block.payload;
  if (block.type === 'TwoColumn') {
    return {
      kind: 'twoColumn',
      splitRatio: normalizeSplitRatio(num(prop(block.meta as Json, 'columnSplitRatio'))),
    };
  }
  if (block.type === 'Page') {
    return { kind: 'page', referenceNoteId: str(prop(block.meta as Json, 'reference_note_id')) };
  }
  return block.payload;
}

/**
 * A payload's fields, minus the ones whose null means absence.
 *
 * Spreading the payload verbatim would put `"crop": null` on every image ever saved,
 * which is bytes no earlier version wrote and the C# writer does not produce either.
 * Same reason the code block's display fields are written only when set.
 *
 * Below roughly 1e-4 a crop number's JSON text can differ from what `BlockJsonConverter`
 * writes: .NET's writer falls to scientific notation for a small enough double and
 * `JSON.stringify` never does. That has no consumer, the Host re-serializes every commit, so
 * the bytes on disk are always the C# writer's, and `readCrop`'s floor matches it on both sides
 * regardless of which one wrote the number.
 */
function serializePayload(payload: BlockPayload): Json {
  const out: Json = { ...payload };
  if (payload.kind === 'image' && payload.crop === null) delete out.crop;
  return out;
}

export function serializeBlock(block: Block): Json {
  const out: Json = {
    id: block.id,
    type: block.type,
    spans: block.spans.map(serializeSpan),
    payload: serializePayload(backfillPayload(block)),
    meta: serializeMeta(block),
    order: block.order,
  };
  // Written only once assigned, matching BlockJsonConverter: a note that has
  // not been through the sid migration must not gain empty sid fields.
  if (block.sid !== '') out.sid = block.sid;
  // Only when non-empty, matching the C# writer's `Count > 0`. An empty array
  // is a shape that side never emits and drops on the next read, so writing one
  // would make the two serializers disagree on a document neither can represent.
  if (block.children !== null && block.children.length > 0) {
    out.children = block.children.map(serializeBlock);
  }
  return out;
}

export function serializeBlocks(blocks: readonly Block[]): Json[] {
  return blocks.map(serializeBlock);
}
