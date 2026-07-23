/**
 * Makes untrusted external HTML safe to hand to the ProseMirror parser.
 *
 * Two dangers, and neither is the one people expect. ProseMirror never injects
 * raw HTML: it re-renders every pasted node through the schema's own `toDOM`, so
 * a `<script>` or an `onerror` cannot execute from a pasted node. What actually
 * bites is subtler:
 *
 *  - **Resource loads on parse.** An `<img src="http://tracker">` fires its
 *    network request the moment the element exists, even in a document that is
 *    never inserted, in every engine. That is a tracking beacon, not XSS. The
 *    defence is to parse into a `<template>`, whose contents are inert by spec
 *    (no loads, no script execution), and strip the dangerous nodes before
 *    anything live ever sees them.
 *  - **Attributes the schema does read.** The parser has rules for `a[href]` and
 *    `img[src]`, so a `javascript:` href or a remote image src would survive into
 *    the document. Those are neutralised here; a `<script>`'s text content, by
 *    contrast, PM already discards on its own.
 *
 * And a paste is an unbounded input: a few hundred deeply nested or duplicated
 * nodes is enough to make the parser crawl, so depth, node count (attributes
 * included, since one element can carry a quarter-million of them) and raw
 * length are capped and an over-budget paste is rejected here rather than parsed.
 */

import { isSafeUrl } from '../editor/schema/safe-url';

/** Past this the paste is treated as hostile and rejected before parsing. */
const MAX_HTML_LENGTH = 2_000_000;
const MAX_NODES = 20_000;
const MAX_DEPTH = 64;

/**
 * A single element carrying a pathological number of attributes makes the HTML
 * parser itself quadratic (it de-duplicates each new attribute against the ones
 * already on the tag), and that cost is paid inside `innerHTML`, before the
 * node/attribute budget below can count anything. A run this long between a `<`
 * and its `>` is that bomb and nothing legitimate, so it is rejected up front by
 * a cheap string scan.
 */
const OVERLONG_TAG = /<[^>]{65536,}/;

/** The one namespace kept; SVG and MathML subtrees are dropped whole. */
const XHTML_NS = 'http://www.w3.org/1999/xhtml';

/**
 * Elements dropped whole, content and all. `<script>`/`<style>` PM would ignore
 * anyway; the rest are stripped so nothing carries a src, a handler or a nested
 * surprise into the parser. `<img>` included: an external image is dropped on
 * paste (an image arrives as a file through the image plugin, or is staged
 * later), never hotlinked.
 */
const DROP_ELEMENTS: ReadonlySet<string> = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE', 'HEAD', 'META', 'LINK', 'BASE',
  'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED', 'APPLET', 'PORTAL',
  'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'OPTION',
  'IMG', 'PICTURE', 'SOURCE', 'SVG', 'MATH', 'CANVAS', 'VIDEO', 'AUDIO', 'TRACK',
]);

export type SanitizeOutcome = { readonly fragment: DocumentFragment } | { readonly tooLarge: true };

/** Parse `html` inertly and strip everything unsafe, or reject it as too large. */
export function sanitizeExternalHtml(html: string): SanitizeOutcome {
  if (html.length > MAX_HTML_LENGTH || OVERLONG_TAG.test(html)) return { tooLarge: true };

  // A template's contents are an inert document: no scripts run, no <img>/<iframe>
  // fetch, nothing loads until the template is used, which it never is.
  const template = document.createElement('template');
  template.innerHTML = html;

  const budget = { nodes: 0 };
  if (!scrub(template.content, 0, budget)) return { tooLarge: true };
  return { fragment: template.content };
}

/** Depth-first scrub; returns false the moment a DoS cap is exceeded. */
function scrub(parent: ParentNode, depth: number, budget: { nodes: number }): boolean {
  if (depth > MAX_DEPTH) return false;

  const doomed: Element[] = [];
  for (let child = parent.firstElementChild; child; child = child.nextElementSibling) {
    if (++budget.nodes > MAX_NODES) return false;
    // A foreign-namespace root (SVG, MathML) is dropped whole: its tagName is not
    // uppercased in an HTML document, so a case-blind check would miss it, and
    // nothing inside it is content the editor wants.
    if (child.namespaceURI !== XHTML_NS || DROP_ELEMENTS.has(child.tagName.toUpperCase())) {
      doomed.push(child);
      continue;
    }
    // Attributes count against the budget too: one element can carry hundreds of
    // thousands, and both the parse and this scrub pay for every one.
    budget.nodes += child.attributes.length;
    if (budget.nodes > MAX_NODES) return false;
    scrubAttributes(child);
    if (!scrub(child, depth + 1, budget)) return false;
  }
  // Removed after the walk so the live sibling chain is not mutated mid-iteration.
  for (const element of doomed) element.remove();
  return true;
}

function scrubAttributes(element: Element): void {
  for (const attr of Array.from(element.attributes)) {
    const name = attr.name.toLowerCase();
    if (name.startsWith('on')) {
      element.removeAttribute(attr.name);
    } else if (name === 'href') {
      if (!isSafeUrl(attr.value)) element.removeAttribute(attr.name);
    } else if (
      name === 'src' || name === 'srcset' || name === 'xlink:href' ||
      name === 'background' || name === 'action' || name === 'formaction'
    ) {
      element.removeAttribute(attr.name);
    }
  }
}
