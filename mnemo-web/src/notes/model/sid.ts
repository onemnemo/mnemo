/**
 * Short identifiers, mirroring `Mnemo.Core/Identity/Sid.cs`.
 *
 * **The alphabet and the lengths are frozen.** Sids were backfilled onto every
 * block in real user data, a persisted sid is durable from the moment it is
 * issued, and the model quotes them back in chat history. If collision pressure
 * ever justifies more space, mint *longer* ids for new blocks and leave the
 * existing ones alone, the lengths below are minimums, never assumptions, and
 * a re-backfill is never the answer.
 *
 * The alphabet drops every pair that is confusable in a proportional font or in
 * speech: no 0/O, no 1/l/I, no u. That costs entropy per character and buys
 * something worth more here, because a small local model addressing a block by
 * sid must not have a one-character transcription slip land on a different real
 * block.
 */

/** Frozen. See the file comment before touching this. */
export const sidAlphabet = '23456789abcdefghjkmnpqrstvwxyz';

/** Block sids are unique within their note, the only scope that resolves one. */
export const blockSidLength = 5;

/** Note sids are unique across the corpus, since nothing encloses a note. */
export const noteSidLength = 6;

/**
 * Whether `value` could have been minted by this contract.
 *
 * Length is a floor rather than an equality check, so ids minted after a future
 * widening still validate against the code that predates it.
 */
export function isWellFormedSid(value: string | null | undefined, minLength: number): boolean {
  if (typeof value !== 'string' || value.length < minLength) return false;
  for (const char of value) {
    if (!sidAlphabet.includes(char)) return false;
  }
  return true;
}

export const isWellFormedBlockSid = (value: string | null | undefined): boolean =>
  isWellFormedSid(value, blockSidLength);

export const isWellFormedNoteSid = (value: string | null | undefined): boolean =>
  isWellFormedSid(value, noteSidLength);

/** Fills `out` with random bytes. Injectable so tests can be deterministic. */
export type RandomSource = (out: Uint8Array<ArrayBuffer>) => void;

const cryptoRandom: RandomSource = (out) => {
  crypto.getRandomValues(out);
};

/**
 * The largest multiple of the alphabet size that fits in a byte.
 *
 * Bytes at or above it are discarded rather than folded in with `%`. The
 * alphabet is 30 characters and 256 is not a multiple of 30, so a plain modulo
 * would make the first 16 characters measurably likelier than the rest,
 * shrinking the real id space for no reason.
 */
const unbiasedCeiling = Math.floor(256 / sidAlphabet.length) * sidAlphabet.length;

function randomSid(length: number, random: RandomSource): string {
  let out = '';
  const buffer = new Uint8Array(length);
  while (out.length < length) {
    random(buffer);
    for (const byte of buffer) {
      if (out.length === length) break;
      if (byte >= unbiasedCeiling) continue;
      out += sidAlphabet[byte % sidAlphabet.length];
    }
  }
  return out;
}

/**
 * Mints a sid that is not already in `taken`.
 *
 * Uniqueness is checked rather than assumed. At five characters the space is
 * ~24 million and a note holds thousands of blocks at most, so a collision is
 * rare, but "rare" over every block of every note is not "never", and a
 * duplicate sid makes both blocks permanently ambiguous to the model.
 */
export function mintSid(
  taken: ReadonlySet<string>,
  length: number = blockSidLength,
  random: RandomSource = cryptoRandom,
): string {
  // Bounded so a caller that passes an exhausted or pathological `taken` set
  // fails loudly instead of spinning forever inside a document load.
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const candidate = randomSid(length, random);
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`could not mint a unique ${String(length)}-character sid in 1000 attempts`);
}
