/**
 * The formatting toolbar's colour picker: a curated 5-swatch subset of the ten
 * design tokens each theme defines, one row for text colour and one for
 * background. Ported from `ColorSwatchPopup.axaml` verbatim, including which
 * of the ten slots each row picks, the desktop picker deliberately shows only
 * five of each so the popover stays scannable, while the themes keep all ten
 * slots defined so a document coloured by an older build still renders.
 *
 * `token: null` is the "default"/"none" cell: it clears the mark rather than
 * setting one, which is why the swatch command exposes a separate `clear`
 * alongside `runWith`, a null token is not a colour to apply.
 */

export interface SwatchCell {
  /** The wire token `runWith` applies, or null for the clearing cell. */
  readonly token: string | null;
  /** CSS custom property carrying the swatch's colour, or null for the clearing cell. */
  readonly cssVar: string | null;
  /**
   * `NotesEditor` key for the cell's tooltip. Only the clearing cell carries
   * one, matching the desktop: a colour cell shows its colour, and naming it
   * would need a translated name per swatch per theme for no added clarity.
   */
  readonly labelKey?: string;
}

export const TEXT_SWATCHES: readonly SwatchCell[] = [
  { token: null, cssVar: null, labelKey: 'ColorDefault' },
  { token: 'swatch5', cssVar: '--text-color-swatch-5' },
  { token: 'swatch8', cssVar: '--text-color-swatch-8' },
  { token: 'swatch3', cssVar: '--text-color-swatch-3' },
  { token: 'swatch6', cssVar: '--text-color-swatch-6' },
  { token: 'swatch2', cssVar: '--text-color-swatch-2' },
];

export const BACKGROUND_SWATCHES: readonly SwatchCell[] = [
  { token: null, cssVar: null, labelKey: 'ColorNone' },
  { token: 'swatch7', cssVar: '--color-swatch-7' },
  { token: 'swatch9', cssVar: '--color-swatch-9' },
  { token: 'swatch6', cssVar: '--color-swatch-6' },
  { token: 'swatch5', cssVar: '--color-swatch-5' },
  { token: 'swatch1', cssVar: '--color-swatch-1' },
];
