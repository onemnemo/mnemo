/**
 * Deterministic content generators for the fixture: readable-ish placeholder prose, code
 * snippets, and LaTeX. None of this is meant to be realistic corpus data, only varied enough
 * that per-element cost (a long code block, a wide math expression) is exercised rather than
 * every element being a trivial identical string that would flatter every renderer equally.
 */

import { nextInt, pick, shuffle, type Rng } from '../prng'

const WORD_BANK = [
  'photosynthesis', 'entropy', 'derivative', 'axiom', 'lattice', 'kernel', 'gradient',
  'heuristic', 'polymer', 'isotope', 'ledger', 'quorum', 'synapse', 'vector', 'manifold',
  'catalyst', 'diffusion', 'protocol', 'inference', 'topology', 'cipher', 'momentum',
  'recursion', 'invariant', 'buffer', 'threshold', 'anomaly', 'schema', 'covariance',
  'oscillator', 'chromatin', 'ecosystem', 'valence', 'transducer', 'annotation',
] as const

/** A short, capitalized phrase built from the word bank. Used for titles and labels. */
export function lorem(rng: Rng, wordCount: number): string {
  const words = Array.from({ length: wordCount }, () => pick(rng, WORD_BANK))
  const [first, ...rest] = words
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ')
}

/** A longer sentence-shaped string, for node/free text bodies. */
export function loremSentence(rng: Rng): string {
  return `${lorem(rng, nextInt(rng, 3, 9))}.`
}

// ---- Math -----------------------------------------------------------------------------

/**
 * Small, valid LaTeX that fits comfortably inside a 132x40 node without downscaling.
 */
export const MATH_POOL_SMALL: readonly string[] = [
  'x^2 + y^2 = z^2',
  'E = mc^2',
  '\\frac{a}{b}',
  '\\sqrt{2}',
  '\\alpha + \\beta = \\gamma',
  'a_n = a_1 + (n-1)d',
  '\\sin^2\\theta + \\cos^2\\theta = 1',
  'f(x) = x^2 - 1',
  '\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1',
]

/**
 * Valid but genuinely tall/wide LaTeX (nested fractions, matrices, big operators), so the
 * downscale path (`min(1, min(boxW/mathW, boxH/mathH))`) is exercised against real content
 * rather than something that happens to already fit.
 */
export const MATH_POOL_TALL: readonly string[] = [
  '\\frac{\\frac{a+b}{c-d}}{\\frac{e+f}{g-h}}',
  '\\begin{pmatrix} a & b & c \\\\ d & e & f \\\\ g & h & i \\end{pmatrix}',
  '\\sum_{i=0}^{n} \\sum_{j=0}^{m} \\frac{i^2 + j^2}{i + j + 1}',
  '\\int_{-\\infty}^{\\infty} \\frac{e^{-x^2}}{\\sqrt{2\\pi}} \\, dx',
  '\\prod_{k=1}^{n} \\left(1 + \\frac{1}{k^2}\\right)',
  '\\begin{bmatrix} \\frac{a}{b} & \\frac{c}{d} \\\\ \\frac{e}{f} & \\frac{g}{h} \\end{bmatrix}',
]

/** Deliberately malformed: an unclosed brace and a reference to a command that does not exist. */
export const UNPARSEABLE_LATEX = '\\frac{1}{2 \\notarealcommand{x'

/**
 * Builds `count` LaTeX payloads for math nodes. At three or more, the pool always includes the
 * empty string, the unparseable string, and a handful of oversized expressions, because those
 * are the cases the downscale/fallback path actually needs exercised; below three there is not
 * enough room to guarantee all of that without every math node in a tiny fixture being broken,
 * so the generator falls back to ordinary valid content instead.
 */
export function buildMathLatexPool(count: number, rng: Rng): string[] {
  const result: string[] = []
  if (count >= 3) {
    result.push('')
    result.push(UNPARSEABLE_LATEX)
    const tallReserve = Math.min(MATH_POOL_TALL.length, Math.max(1, Math.round((count - 2) * 0.15)))
    for (let i = 0; i < tallReserve; i += 1) result.push(MATH_POOL_TALL[i % MATH_POOL_TALL.length])
  }
  while (result.length < count) result.push(pick(rng, MATH_POOL_SMALL))
  return shuffle(rng, result)
}

// ---- Code -------------------------------------------------------------------------------

const CODE_SNIPPETS: readonly { language: string; source: string }[] = [
  { language: 'typescript', source: 'export function clamp(v: number, lo: number, hi: number) {\n  return Math.min(hi, Math.max(lo, v))\n}' },
  { language: 'python', source: 'def fib(n):\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a' },
  { language: 'csharp', source: 'public static int Gcd(int a, int b) =>\n    b == 0 ? a : Gcd(b, a % b);' },
  { language: 'rust', source: 'fn is_prime(n: u32) -> bool {\n    (2..n).all(|d| n % d != 0)\n}' },
  { language: 'sql', source: 'SELECT id, COUNT(*) AS total\nFROM events\nGROUP BY id\nORDER BY total DESC;' },
  { language: 'cpp', source: 'int gcd(int a, int b) {\n    return b == 0 ? a : gcd(b, a % b);\n}' },
]

export function pickCodeSnippet(rng: Rng): { language: string; source: string } {
  return pick(rng, CODE_SNIPPETS)
}

// ---- Misc identifiers -------------------------------------------------------------------

const IMAGE_STEMS = ['diagram', 'photo', 'scan', 'chart', 'screenshot', 'sketch'] as const

export function imageAssetId(rng: Rng, index: number): string {
  return `${pick(rng, IMAGE_STEMS)}-${String(index).padStart(4, '0')}.png`
}

export function refTargetId(kind: 'note' | 'flashcard', index: number): string {
  return kind === 'note' ? `note-${index}` : `deck-${index}::card-${index}`
}
