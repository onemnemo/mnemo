/**
 * Plain text -> `Block[]`: the paste dialect the desktop falls back to.
 *
 * The desktop has no HTML paste path at all, so its whole cross-app import is
 * this one function, `BlockMarkdownSerializer.Deserialize`, and matching it byte
 * for byte is what makes a note copied on the desktop paste back the same here.
 * The reader is deliberately line-oriented and forgiving, the same shape as the
 * original: one block per line, a handful of multi-line fences, and a plain-text
 * fallback that still runs the inline markdown parser so `**bold**` in pasted
 * text becomes bold rather than literal asterisks.
 *
 * It returns wire `Block`s, not ProseMirror nodes, for two reasons: it mirrors
 * the desktop, whose `Deserialize` returns view models the placement code then
 * drops in; and it stays a pure function of a string, testable without a schema.
 * Every block comes out with an empty `id`/`sid`, which is the signal the
 * identity plugin mints against once the run is dispatched, the same contract
 * the exact-slice paste path relies on.
 *
 * Two dialects are read where they diverge. The port emits a numbered item as a
 * literal `1.` and renumbers on render, so the stored index is not read back.
 * Sketch is accepted under both the desktop's ```sketch and the port's own
 * ```mnemo-sketch fence, since a note can arrive from either side; the page card
 * is read only in the desktop's `[[page:id]]` form, which the port now also
 * emits, so a bare `[[wikilink]]` stays literal text rather than becoming a
 * broken card.
 */

import { parseInlineMarkdown } from '../model/markdown';
import { plainSpan } from '../model/spans';
import type { Block, BlockPayload, BlockType, InlineSpan } from '../model/types';

/** A page reference in either the desktop or the port's own emitted form. */
const PAGE_REF = /^\[\[page:([^\]]*)\]\]\s*$/;
/** A bullet introduced by `*` or `+`; the trailing space stops `*emphasis*` reading as a list. */
const STAR_BULLET = /^(?:\*|\+)\s+(.*)$/;
/** A numbered item; the index is captured but the port renumbers on render, so it is not stored. */
const NUMBERED = /^(\d+)\.\s/;
/** `![alt](target)` on a line of its own. */
const IMAGE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/;

/** Parses a Mnemo-markdown string into wire blocks, empty of identity. */
export function parseMarkdownToBlocks(markdown: string): Block[] {
  if (markdown.trim() === '') return [];

  const lines = markdown.split(/\r\n|\r|\n/);
  const out: Block[] = [];
  let order = 0;
  let i = 0;

  const emit = (type: BlockType, spans: readonly InlineSpan[], payload: BlockPayload): void => {
    out.push(makeBlock(type, spans, payload, order++));
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.replace(/^\s+/, '');

    // Divider.
    if (trimmed === '---' || line.trim() === '---') {
      emit('Divider', [plainSpan('')], { kind: 'empty' });
      i++;
      continue;
    }

    // Page reference.
    const page = PAGE_REF.exec(trimmed);
    if (page) {
      emit('Page', [plainSpan('')], { kind: 'page', referenceNoteId: page[1].trim() });
      i++;
      continue;
    }

    // Equation: a `$$` fence, either the whole line or a block opened on its own.
    if (trimmed === '$$' || (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 2)) {
      if (trimmed === '$$') {
        const body: string[] = [];
        i++;
        while (i < lines.length) {
          if (lines[i].replace(/^\s+/, '') === '$$') {
            i++;
            break;
          }
          body.push(lines[i]);
          i++;
        }
        emit('Equation', [plainSpan('')], { kind: 'equation', latex: body.join('\n').trim() });
      } else {
        emit('Equation', [plainSpan('')], { kind: 'equation', latex: trimmed.slice(2, -2).trim() });
        i++;
      }
      continue;
    }

    // Code / sketch fence.
    if (trimmed.startsWith('```')) {
      const fence = trimmed.length > 3 ? trimmed.slice(3).trim() : '';
      const isSketch = fence.toLowerCase() === 'sketch' || fence.toLowerCase() === 'mnemo-sketch';
      const language = fence === '' ? 'csharp' : fence;
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        if (lines[i].replace(/^\s+/, '').startsWith('```')) {
          i++;
          break;
        }
        body.push(lines[i]);
        i++;
      }
      const source = body.join('\n');
      if (isSketch) {
        emit('Sketch', [plainSpan(source)], { kind: 'sketch', width: 0, align: 'left' });
      } else {
        emit('Code', [plainSpan(source)], { kind: 'code', language, source });
      }
      continue;
    }

    // Headings, longest fence first so `##` never matches as `#`.
    const heading = headingOf(trimmed);
    if (heading) {
      emit(heading.type, parseInlineMarkdown(heading.content), { kind: 'empty' });
      i++;
      continue;
    }

    // Checklist, checked then unchecked.
    if (/^-\s*\[\s*[xX]\s*\]/.test(trimmed)) {
      const content = trimmed.replace(/^-\s*\[\s*[xX]\s*\]\s*/, '').trim();
      emit('Checklist', parseInlineMarkdown(content), { kind: 'checklist', checked: true });
      i++;
      continue;
    }
    if (/^-\s*\[\s*\]/.test(trimmed)) {
      const content = trimmed.replace(/^-\s*\[\s*\]\s*/, '').trim();
      emit('Checklist', parseInlineMarkdown(content), { kind: 'checklist', checked: false });
      i++;
      continue;
    }

    // Bullet: `- `, then the CommonMark `*`/`+` markers.
    if (trimmed.startsWith('- ')) {
      emit('BulletList', parseInlineMarkdown(trimmed.slice(2).trim()), { kind: 'empty' });
      i++;
      continue;
    }
    const star = STAR_BULLET.exec(trimmed);
    if (star) {
      emit('BulletList', parseInlineMarkdown(star[1].trim()), { kind: 'empty' });
      i++;
      continue;
    }

    // Quote: consecutive `> ` (or bare `>`) lines fold into one multi-line block.
    if (trimmed.startsWith('> ') || trimmed === '>') {
      const quoted: string[] = [trimmed === '>' ? '' : trimmed.slice(2).trim()];
      i++;
      while (i < lines.length) {
        const next = lines[i].replace(/^\s+/, '');
        if (next.startsWith('> ')) {
          quoted.push(next.slice(2).trim());
          i++;
        } else if (next === '>') {
          quoted.push('');
          i++;
        } else {
          break;
        }
      }
      emit('Quote', parseInlineMarkdown(quoted.join('\n')), { kind: 'empty' });
      continue;
    }

    // Numbered item. The index is read to confirm the match but not stored.
    if (NUMBERED.test(trimmed)) {
      const content = trimmed.replace(/^\d+\.\s*/, '').trim();
      emit('NumberedList', parseInlineMarkdown(content), { kind: 'empty' });
      i++;
      continue;
    }

    // A lone image reference.
    const image = IMAGE.exec(trimmed);
    if (image) {
      const path = unescapeImageTarget(image[2].trim());
      const alt = unescapeImageAlt(image[1]);
      emit('Image', [plainSpan(alt)], { kind: 'image', path, alt, width: 0, align: 'left' });
      i++;
      continue;
    }

    // Plain text: the raw line, so leading indentation is not silently trimmed,
    // still through the inline parser so pasted markdown styling survives.
    emit('Text', parseInlineMarkdown(line), { kind: 'empty' });
    i++;
  }

  return out;
}

const HEADINGS: readonly { readonly fence: string; readonly type: BlockType }[] = [
  { fence: '#### ', type: 'Heading4' },
  { fence: '### ', type: 'Heading3' },
  { fence: '## ', type: 'Heading2' },
  { fence: '# ', type: 'Heading1' },
];

function headingOf(trimmed: string): { type: BlockType; content: string } | null {
  for (const { fence, type } of HEADINGS) {
    if (trimmed.startsWith(fence)) return { type, content: trimmed.slice(fence.length).trim() };
  }
  return null;
}

function makeBlock(
  type: BlockType,
  spans: readonly InlineSpan[],
  payload: BlockPayload,
  order: number,
): Block {
  // Empty id/sid is the contract: the identity plugin mints fresh, note-scoped
  // ids on the paste transaction, so nothing collides with an existing block.
  return { id: '', sid: '', type, spans: [...spans], payload, meta: {}, order, children: null };
}

/** `<target>` angle-bracket wrapping is stripped, matching the desktop reader. */
function unescapeImageTarget(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/** Reverses the alt escaping the image serializer applies, `\]` and `\\` in order. */
function unescapeImageAlt(alt: string): string {
  return alt.replaceAll('\\]', ']').replaceAll('\\\\', '\\');
}
