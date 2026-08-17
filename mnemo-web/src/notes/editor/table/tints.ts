/**
 * The fills a cell can take.
 *
 * The eight branch hues, plus grey and the default. The same set the mindmap
 * spends, which is the argument for having any colour here at all: the
 * application frame stays monochrome, and hues appear only inside a structure
 * the user built. A tinted row is that.
 *
 * Ids are stored on the block, so they are stable tokens and never display
 * strings; the label is a translation key.
 */

export interface Tint {
  readonly id: string;
  /** Key in the NotesEditor namespace. */
  readonly labelKey: string;
  /** oklch hue angle. Empty for the default, which paints nothing. */
  readonly hue: string;
  /** Multiplier on the theme's cell chroma, so one pair of numbers per theme governs all nine. */
  readonly chroma: number;
}

/**
 * The tint that is the absence of one, and what a cell stores for it: nothing.
 *
 * Named because three places have to agree on it (the menu that offers it, the
 * fill that reports it, and the paint that skips it), and a literal `'none'`
 * repeated three times is three chances to disagree.
 */
export const NO_TINT = 'none';

export const tableTints: readonly Tint[] = Object.freeze([
  { id: NO_TINT, labelKey: 'TableTintNone', hue: '', chroma: 0 },
  { id: 'grey', labelKey: 'TableTintGrey', hue: '60', chroma: 0.12 },
  { id: 'red', labelKey: 'TableTintRed', hue: '22', chroma: 1 },
  { id: 'amber', labelKey: 'TableTintAmber', hue: '72', chroma: 1 },
  { id: 'green', labelKey: 'TableTintGreen', hue: '148', chroma: 1 },
  { id: 'teal', labelKey: 'TableTintTeal', hue: '205', chroma: 1 },
  { id: 'blue', labelKey: 'TableTintBlue', hue: '258', chroma: 1 },
  { id: 'violet', labelKey: 'TableTintViolet', hue: '305', chroma: 1 },
  { id: 'pink', labelKey: 'TableTintPink', hue: '350', chroma: 1 },
]);

/**
 * The paint for a tint, or null for no fill.
 *
 * Never a colour that happens to equal the canvas: a cell with no fill has to
 * inherit the selection wash and the header surface underneath it rather than
 * cover them.
 */
export function tintFill(id: string | undefined): string | null {
  const tint = tableTints.find((candidate) => candidate.id === id);
  if (!tint || tint.id === NO_TINT) return null;
  return `oklch(var(--cell-l) calc(var(--cell-c) * ${tint.chroma}) ${tint.hue})`;
}
