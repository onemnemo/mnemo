/**
 * The cover presets. A cover is stored as an opaque token, not a colour, so the
 * palette can be retuned without rewriting saved notes and an unknown token from
 * a newer build reads as "no cover" rather than a broken banner.
 *
 * Lightness and chroma are fixed per stop; only the hue turns, so every banner
 * carries the same weight and none of them fights the reading surface below it.
 */
export interface NoteCover {
  readonly token: string;
  readonly css: string;
}

export const NOTE_COVERS: readonly NoteCover[] = [
  { token: 'sunset', css: 'linear-gradient(120deg, oklch(0.72 0.14 28) 0%, oklch(0.6 0.16 350) 55%, oklch(0.55 0.15 275) 100%)' },
  { token: 'dawn', css: 'linear-gradient(120deg, oklch(0.82 0.11 70) 0%, oklch(0.68 0.14 30) 100%)' },
  { token: 'meadow', css: 'linear-gradient(120deg, oklch(0.75 0.12 145) 0%, oklch(0.62 0.13 190) 100%)' },
  { token: 'ocean', css: 'linear-gradient(120deg, oklch(0.72 0.12 230) 0%, oklch(0.55 0.14 275) 100%)' },
  { token: 'berry', css: 'linear-gradient(120deg, oklch(0.7 0.15 350) 0%, oklch(0.58 0.15 315) 100%)' },
  { token: 'slate', css: 'linear-gradient(120deg, oklch(0.62 0.03 250) 0%, oklch(0.45 0.02 260) 100%)' },
];

/** The gradient for a stored token, or null when it names no known preset. */
export function coverCss(token: string | null | undefined): string | null {
  if (!token) return null;
  return NOTE_COVERS.find((cover) => cover.token === token)?.css ?? null;
}
