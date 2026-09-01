/**
 * Reading a stored crop, the one payload field that is an object rather than a scalar.
 *
 * Three entry points can hand the block something that is not a crop: the wire reader
 * (a saved note, possibly written by a build that spelled it differently), the schema's
 * attrs (a `fromJSON` of a document from anywhere), and the markup an internal copy
 * re-parses. All three come through here, and a shape that does not check out reads as
 * *no* crop rather than as a broken one, because the five numbers only mean anything
 * together: a window with three of them is not a smaller crop, it is an unrenderable one.
 */

import type { ImageCrop } from '../../components/ui/image-editor/geometry';

/**
 * Matching the wire reader's own lookup, which the .NET converter's case-insensitive matching
 * requires. Correct only because every call site here passes a lowercase literal for `name`;
 * unlike `wire.ts`'s `prop()`, this does not lowercase `name` itself.
 */
function at(source: Record<string, unknown>, name: string): unknown {
  if (name in source) return source[name];
  for (const key of Object.keys(source)) {
    if (key.toLowerCase() === name) return source[key];
  }
  return undefined;
}

function fraction(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

/**
 * The floor below which a window stops being a real crop. The Typst emitter divides by `w`, `h`
 * and `aspect`, and its 6-decimal ratio formatting rounds anything under 5e-7 to a literal zero,
 * which fails the whole exported document with a divide by zero. Matches the C# reader's floor.
 */
const MIN_FRACTION = 1e-6;

/**
 * A crop out of arbitrary data, or null when it is not one.
 *
 * A width or height under `MIN_FRACTION` is rejected along with the outright malformed: such a
 * window samples no pixels, and every renderer of a crop divides by those two numbers.
 */
export function readCrop(value: unknown): ImageCrop | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;

  const x = fraction(at(source, 'x'));
  const y = fraction(at(source, 'y'));
  const w = fraction(at(source, 'w'));
  const h = fraction(at(source, 'h'));
  if (x === null || y === null || w === null || h === null || w < MIN_FRACTION || h < MIN_FRACTION) return null;

  const aspect = at(source, 'aspect');
  if (typeof aspect !== 'number' || !Number.isFinite(aspect) || aspect < MIN_FRACTION) return null;

  return { x, y, w, h, aspect };
}

/** The crop as the block's own markup carries it, so an internal copy round-trips it. */
export function cropAttributeOf(crop: ImageCrop | null): string {
  return crop === null ? '' : JSON.stringify(crop);
}

/** And back, from markup that may hold anything at all. */
export function readCropAttribute(value: string | null): ImageCrop | null {
  if (value === null || value.length === 0) return null;
  try {
    return readCrop(JSON.parse(value));
  } catch {
    return null;
  }
}
