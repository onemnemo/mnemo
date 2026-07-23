/**
 * Untrusted external HTML to a ProseMirror slice.
 *
 * HTML from another app is sanitised first, then parsed with the editor's own
 * schema, so the result is only ever nodes the schema already knows, minus
 * anything the sanitiser stripped. `too-large` is reported separately so the
 * caller can degrade to plain text rather than let an unbounded paste through.
 *
 * Our own copy takes a different path entirely, restoring the exact slice from
 * the JSON payload, because the schema's rendered HTML does not survive a reparse
 * (a block's line is a `<div>` inside a `<p>`, and the parser closes the `<p>`).
 */

import { DOMParser as PMDOMParser, type Schema, type Slice } from 'prosemirror-model';

import { sanitizeExternalHtml } from './html-sanitize';

export type ExternalParse = { readonly slice: Slice } | 'too-large' | null;

/** Sanitise then parse untrusted HTML. Null when it holds nothing usable. */
export function parseExternalHtml(html: string, schema: Schema): ExternalParse {
  if (html.trim() === '') return null;

  const outcome = sanitizeExternalHtml(html);
  if ('tooLarge' in outcome) return 'too-large';

  const slice = PMDOMParser.fromSchema(schema).parseSlice(outcome.fragment, {
    preserveWhitespace: false,
  });
  return slice.content.size === 0 ? null : { slice };
}
