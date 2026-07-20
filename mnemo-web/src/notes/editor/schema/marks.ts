/**
 * The twelve marks, one per `TextStyle` field.
 *
 * One mark per field is what makes the mapper total rather than a switch
 * someone has to remember to extend: the registry checks the module list covers
 * `TextStyle` exactly, so adding a thirteenth field without a mark fails at
 * build rather than silently dropping that field on every save.
 *
 * **Declaration order is load-bearing.** `Mark.addToSet` inserts by `type.rank`,
 * which is schema declaration order, so a mark array serializes identically no
 * matter what order the user applied the formatting in. That is the whole
 * canonicalization pass we would otherwise have had to write and test. The
 * order below matches `TextStyle`'s field order so there is one sequence to
 * keep in mind rather than two.
 *
 * Corpus counts are noted where they are zero or near-zero — several of these
 * exist for parity with data that no real note has ever produced, and are not
 * worth polishing.
 */

import type { MarkSpec } from 'prosemirror-model';
import type { AnyMarkModule, MarkModule } from '../registry/types';
import type { TextStyle } from '../../model/types';

/** Narrows at the definition site so each module body sees its own field type. */
function defineMark<K extends keyof TextStyle>(module: MarkModule<K>): AnyMarkModule {
  return module as AnyMarkModule;
}

/** A boolean flag with no attrs — the shape nine of the twelve marks have. */
function flagMark(
  markName: string,
  styleKey: keyof TextStyle,
  spec: MarkSpec,
  markdown?: { open: string; close: string },
): AnyMarkModule {
  return defineMark({ markName, styleKey, mark: spec, markdown });
}

export const strongMark = flagMark(
  'strong',
  'bold',
  {
    parseDOM: [
      { tag: 'strong' },
      { tag: 'b', getAttrs: (n) => (n as HTMLElement).style.fontWeight !== 'normal' && null },
      { style: 'font-weight=bold' },
      { style: 'font-weight=700' },
    ],
    toDOM: () => ['strong', 0],
  },
  { open: '**', close: '**' },
);

export const emMark = flagMark(
  'em',
  'italic',
  {
    parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }],
    toDOM: () => ['em', 0],
  },
  { open: '*', close: '*' },
);

export const underlineMark = flagMark('underline', 'underline', {
  parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }],
  toDOM: () => ['u', 0],
});

export const strikeMark = flagMark(
  'strike',
  'strikethrough',
  {
    parseDOM: [{ tag: 's' }, { tag: 'del' }, { style: 'text-decoration=line-through' }],
    toDOM: () => ['s', 0],
  },
  { open: '~~', close: '~~' },
);

/** Zero uses in the corpus. Ship it, do not polish it. */
export const codeMark = flagMark(
  'codeMark',
  'code',
  {
    // Deliberately *not* `excludes: "_"`, tempting as it is. `TextStyle.Code` is
    // an independent boolean, so a span with both code and bold set is
    // representable on the wire; excluding here would drop one of them on the
    // first round trip. Compare `sub`/`sup` below, where C# enforces the
    // exclusion and the schema is only restating it.
    parseDOM: [{ tag: 'code' }],
    toDOM: () => ['code', 0],
  },
  { open: '`', close: '`' },
);

export const highlightMark = flagMark('highlight', 'highlight', {
  parseDOM: [{ tag: 'mark' }],
  toDOM: () => ['mark', 0],
});

/**
 * Both swatch marks carry a **design token**, not a color — real data stores
 * `"swatch5"`. Resolving it to a color at render is what lets the theme change
 * without rewriting every note.
 */
function swatchMark(
  markName: string,
  styleKey: 'backgroundColor' | 'foregroundColor',
  domAttr: string,
): AnyMarkModule {
  return defineMark<typeof styleKey>({
    markName,
    styleKey,
    mark: {
      attrs: { token: {} },
      parseDOM: [
        {
          tag: `span[${domAttr}]`,
          getAttrs: (n) => ({ token: (n as HTMLElement).getAttribute(domAttr) ?? '' }),
        },
      ],
      toDOM: (mark) => ['span', { [domAttr]: String(mark.attrs.token) }, 0],
    },
    toAttrs: (value) => (value === null || value === '' ? null : { token: value }),
    fromAttrs: (attrs) => (typeof attrs.token === 'string' && attrs.token !== '' ? attrs.token : null),
  });
}

export const bgSwatchMark = swatchMark('bgSwatch', 'backgroundColor', 'data-bg-swatch');

/** Zero uses in the corpus; exists so the field is not silently dropped. */
export const fgSwatchMark = swatchMark('fgSwatch', 'foregroundColor', 'data-fg-swatch');

/**
 * The single biggest structural win over a wrapping link node: PM models a link
 * as a mark, and the wire format stores `LinkUrl` per span. The mapping is 1:1
 * with no reconciliation pass on either side.
 */
export const linkMark = defineMark<'linkUrl'>({
  markName: 'link',
  styleKey: 'linkUrl',
  mark: {
    attrs: { href: {} },
    // A link is not a container: two adjacent spans with different hrefs must
    // stay two links rather than merging into whichever came first.
    inclusive: false,
    parseDOM: [
      {
        tag: 'a[href]',
        getAttrs: (n) => ({ href: (n as HTMLElement).getAttribute('href') ?? '' }),
      },
    ],
    toDOM: (mark) => ['a', { href: String(mark.attrs.href), rel: 'noopener noreferrer' }, 0],
  },
  toAttrs: (value) => (value === null || value === '' ? null : { href: value }),
  fromAttrs: (attrs) => (typeof attrs.href === 'string' && attrs.href !== '' ? attrs.href : null),
});

/**
 * Marks a run the autolinker must leave alone — the user typed something
 * URL-shaped and explicitly said "not a link".
 *
 * Never true in the corpus. Worth noting only because this is the case that was
 * called invasive under a node-based model, where suppression has nowhere to
 * live but a subclass of every text node. As a mark it is a few lines.
 */
export const noAutoLinkMark = flagMark('noAutoLink', 'suppressAutoLink', {
  parseDOM: [{ tag: 'span[data-no-autolink]' }],
  // Renders no styling, but must render *something* so a copy/paste round trip
  // through the DOM does not lose the suppression.
  toDOM: () => ['span', { 'data-no-autolink': '' }, 0],
});

/**
 * Sub and sup do **not** exclude each other here, though it is tempting and the
 * plan called for it.
 *
 * `MarkSpec.excludes` would be enforced inside `addToSet`, which reads as an
 * elegant way to restate what `TextStyle` already guarantees. It isn't: C#
 * clears the pair in `WithToggle`/`WithSet` — the *command* layer — while
 * `BlockJsonConverter` reads and writes the two booleans independently. The wire
 * format therefore represents both-true, and the frozen cross-language span
 * fixture actually contains it, because its generator rolls `Subscript` and
 * `Superscript` on separate 0.15 coin flips.
 *
 * With `excludes` set, `addToSet` silently evicts `sub` when `sup` follows it,
 * and the span comes back with `subscript: false`. That is a schema refusing to
 * express a state the agreed corpus asserts is valid — data loss to restate an
 * invariant that lives one layer up.
 *
 * The exclusion belongs where C# puts it: in the commands, when they arrive.
 */
export const subMark = flagMark('sub', 'subscript', {
  parseDOM: [{ tag: 'sub' }],
  toDOM: () => ['sub', 0],
});

export const supMark = flagMark('sup', 'superscript', {
  parseDOM: [{ tag: 'sup' }],
  toDOM: () => ['sup', 0],
});

/** Order defines mark rank, and mark rank defines canonical serialization. */
export const markModules: readonly AnyMarkModule[] = [
  strongMark,
  emMark,
  underlineMark,
  strikeMark,
  codeMark,
  highlightMark,
  bgSwatchMark,
  fgSwatchMark,
  linkMark,
  noAutoLinkMark,
  subMark,
  supMark,
];
