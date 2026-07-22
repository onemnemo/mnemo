/**
 * Inline markdown -> `InlineSpan[]`.
 *
 * Mirrors Mnemo.Infrastructure's `InlineMarkdownParser`, which is built on
 * Markdig. This uses remark/micromark rather than a hand-rolled scanner for a
 * specific reason: emphasis is the hardest part of CommonMark to get right
 * (delimiter runs, flanking rules, nesting), and a hand-rolled parser would
 * diverge from Markdig on exactly the inputs nobody thought to write a test
 * for. Two real CommonMark implementations agree far more often than one
 * implementation and one approximation.
 *
 * They still do not agree everywhere. Known, deliberate divergences are listed
 * on `parseInlineMarkdown`.
 *
 * **Block markdown is flattened, not rejected.** A model that sends `- a\n- b`
 * to an op whose `md` is one block's inline content gets a single block reading
 * `a\nb`. That is what the C# parser does and this matches it, but it is worth
 * knowing that the block structure is silently lost rather than reported.
 */

import type { Nodes as MdastNode, Parents as MdastParent, Root } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import { normalizeUrl } from './autolink';
import { setFormat } from './format';
import { normalizeSpans, plainSpan } from './spans';
import { defaultTextStyle, type InlineSpan, type TextStyle } from './types';

/**
 * The Mnemo fraction token: `\1/2`.
 *
 * Not markdown, a Mnemo extension, and it survives the markdown pass because
 * a backslash before a digit is not a CommonMark escape (escapes only apply to
 * ASCII punctuation), so the parser hands the backslash through in a text node.
 */
const fractionToken = /\\(\d+)\/(\d+)/g;

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

/**
 * Parses inline markdown into spans.
 *
 * Deliberate divergences from the C# parser, all inherited from GFM/remark
 * being stricter or looser than Markdig rather than from choices made here:
 *
 * - `~single~` is strikethrough (GFM allows one tilde; Markdig requires two).
 * - `$` spacing rules around inline math differ slightly, so a line with two
 *   literal dollar amounts can parse as math on one side and not the other.
 *
 * Neither is worth forcing into agreement: the C# path is replaced at cutover,
 * and both readings here are the ones a model writing GFM would expect.
 */
export function parseInlineMarkdown(markdown: string | null | undefined): InlineSpan[] {
  if (!markdown) return [plainSpan('')];

  const root = processor.parse(markdown) as Root;
  const spans: InlineSpan[] = [];

  root.children.forEach((block, index) => {
    // Top-level blocks are joined by a newline, so flattening a multi-block
    // document keeps its line structure even though it loses its block types.
    if (index > 0) spans.push(plainSpan('\n'));
    visitBlock(block, spans);
  });

  // A document that parsed to nothing at all -- whitespace, a bare thematic
  // break -- still produces one empty span, because a block with no spans has
  // nowhere to put the caret. `normalizeSpans` guarantees that, so there is no
  // fallback here.
  return normalizeSpans(spans);
}

function visitBlock(node: MdastNode, spans: InlineSpan[]): void {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
      visitChildren(node, defaultTextStyle, spans);
      break;

    // Fenced and indented code arrive as one value rather than as inline
    // children, and the fence itself is not part of the text.
    case 'code':
      spans.push(plainSpan(node.value));
      break;

    case 'thematicBreak':
      break;

    case 'blockquote':
    case 'list':
    case 'listItem':
      visitBlockContainer(node, spans);
      break;

    default:
      if ('children' in node) visitChildren(node, defaultTextStyle, spans);
      break;
  }
}

/** Newline-joins the children of a nested block container: quotes, lists, list items. */
function visitBlockContainer(node: MdastParent, spans: InlineSpan[]): void {
  node.children.forEach((child, index) => {
    if (index > 0) spans.push(plainSpan('\n'));
    visitBlock(child, spans);
  });
}

function visitChildren(node: MdastParent, style: TextStyle, spans: InlineSpan[]): void {
  for (const child of node.children) visitInline(child, style, spans);
}

function visitInline(node: MdastNode, style: TextStyle, spans: InlineSpan[]): void {
  switch (node.type) {
    case 'text':
      if (node.value.length > 0) pushTextWithFractions(node.value, style, spans);
      break;

    case 'inlineCode':
      spans.push({ kind: 'text', text: node.value, style: setFormat(style, 'code') });
      break;

    case 'strong':
      visitChildren(node, setFormat(style, 'bold'), spans);
      break;

    case 'emphasis':
      visitChildren(node, setFormat(style, 'italic'), spans);
      break;

    case 'delete':
      visitChildren(node, setFormat(style, 'strike'), spans);
      break;

    // A hard break is a newline inside one block, not a block boundary.
    case 'break':
      spans.push({ kind: 'text', text: '\n', style });
      break;

    case 'link': {
      const href = node.url ? normalizeUrl(node.url) : '';
      // An empty destination is not a link. Marking it as one would produce a
      // span that renders as a link and navigates nowhere.
      visitChildren(node, href ? setFormat(style, 'link', href) : style, spans);
      break;
    }

    case 'inlineMath': {
      const latex = node.value.trim();
      // Equations carry no style: `$x$` inside bold is still just the equation,
      // matching the C# span model where EquationSpan has no style of its own.
      if (latex.length > 0) spans.push({ kind: 'equation', latex, style: { ...defaultTextStyle } });
      break;
    }

    // Raw HTML is dropped rather than shown. A note is not a web page, and
    // echoing the tag text would be noise in every case where it appears.
    case 'html':
      break;

    default:
      if ('children' in node) visitChildren(node, style, spans);
      break;
  }
}

/** Splits `\1/2` tokens out of a literal run into fraction atoms. */
function pushTextWithFractions(text: string, style: TextStyle, spans: InlineSpan[]): void {
  let pos = 0;
  fractionToken.lastIndex = 0;

  for (const match of text.matchAll(fractionToken)) {
    const at = match.index;
    if (at > pos) spans.push({ kind: 'text', text: text.slice(pos, at), style });

    const numerator = Number(match[1]);
    const denominator = Number(match[2]);
    // A zero denominator is not a fraction; the token stays literal text rather
    // than becoming an atom that cannot be rendered.
    if (Number.isSafeInteger(numerator) && Number.isSafeInteger(denominator) && denominator > 0) {
      spans.push({ kind: 'fraction', numerator, denominator, style });
    } else {
      spans.push({ kind: 'text', text: match[0], style });
    }

    pos = at + match[0].length;
  }

  if (pos < text.length) spans.push({ kind: 'text', text: text.slice(pos), style });
}
