/**
 * The callout: a tinted aside with a leading glyph.
 *
 * Structurally a quote, one line of inline content, not a container. The design
 * draws a single paragraph inside the frame and offers no affordance for adding
 * a second block to it, and a container would need the `ColumnGroup` nesting
 * scheme to be worth the cost. The factory's default `line block*` content is
 * kept anyway, so a note that somehow arrives with a child renders instead of
 * quarantining the whole document.
 *
 * The glyph is a button drawn by {@link calloutView}, which is what lets it be
 * pressed to change it. `toDOM` still emits the bare aside with the glyph in an
 * attr: the live DOM is the view's business, the serialized shape is the
 * contract with every note already written and with the clipboard.
 */

import type { AnyBlockModule } from '../registry/types';
import type { BlockType } from '../../model/types';
import { calloutView } from './callout-view';
import { defineBlock, type BlockDeps } from './shared';
import { convertHere } from './slash-insert';

/** Matches `CalloutPayload`'s C# default, so a callout with no glyph is expressible. */
const defaultTone = 'note';
const noteEmoji = '💡';
const warnEmoji = '⚠️';

interface CalloutAttrs extends Record<string, unknown> {
  emoji: string;
  tone: string;
}

export function calloutBlock(deps: BlockDeps): AnyBlockModule {
  return defineBlock<CalloutAttrs>(
    {
      nodeName: 'callout',
      wireTypes: ['Callout'],
      attrs: { emoji: { default: noteEmoji }, tone: { default: defaultTone } },
      nodeOptions: {
        parseDOM: [
          {
            tag: 'aside[data-callout]',
            getAttrs: (n) => ({
              emoji: (n as HTMLElement).getAttribute('data-callout-emoji') ?? '',
              tone: (n as HTMLElement).getAttribute('data-callout-tone') || defaultTone,
            }),
          },
        ],
        toDOM: (node) => [
          'aside',
          {
            'data-callout': '',
            'data-callout-tone': String(node.attrs.tone ?? defaultTone),
            'data-callout-emoji': String(node.attrs.emoji ?? ''),
          },
          0,
        ],
      },
      attrsFrom: (block) => ({
        emoji: block.payload.kind === 'callout' ? block.payload.emoji : noteEmoji,
        tone: block.payload.kind === 'callout' ? block.payload.tone : defaultTone,
      }),
      wireFrom: (node) => ({
        type: 'Callout' as BlockType,
        payload: {
          kind: 'callout' as const,
          emoji: String(node.attrs.emoji ?? ''),
          tone: String(node.attrs.tone ?? defaultTone) || defaultTone,
        },
      }),
      // A real pressable glyph in front of the text; the attr alone is a marker
      // a press goes straight through.
      realizedView: calloutView,
      // `> [!tone glyph]`, the shape the C# converter reads back. Continuation
      // lines carry their own `> ` because without it a multi-line callout
      // re-imports as a callout followed by loose paragraphs.
      toMarkdown: (node, _ctx, inline) => {
        const tone = String(node.attrs.tone ?? defaultTone).trim() || defaultTone;
        const emoji = String(node.attrs.emoji ?? '').trim();
        const head = `> [!${tone}${emoji.length > 0 ? ` ${emoji}` : ''}]`;
        return inline.length > 0 ? `${head} ${inline.replace(/\n/g, '\n> ')}\n` : `${head}\n`;
      },
      // Two rows on one node, the way heading gives four. The design shows no
      // way to change a callout's tone after the fact, so the tone is chosen at
      // insert time or not at all.
      slash: [
        {
          label: 'Callout',
          description: 'CalloutDescription',
          icon: 'notes/callout',
          keywords: ['note', 'info', 'aside'],
          group: 'text',
          insert: convertHere('callout', { emoji: noteEmoji, tone: defaultTone }),
        },
        {
          label: 'CalloutWarning',
          description: 'CalloutWarningDescription',
          icon: 'triangle-alert',
          keywords: ['warning', 'caution', 'alert'],
          group: 'text',
          insert: convertHere('callout', { emoji: warnEmoji, tone: 'warn' }),
        },
      ],
    },
    deps,
  );
}
