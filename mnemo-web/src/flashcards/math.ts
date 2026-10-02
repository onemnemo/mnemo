// Splitting and stripping for card text that carries LaTeX. `$…$` inline, `$$…$$` on its own
// line, nothing else, deliberately: the delimiters are what every student who has met LaTeX
// already types, and a second dialect would only need explaining.
//
// Kept apart from the component that renders this (CardText.tsx) so the deck table, which
// never renders KaTeX, does not pull it in just to strip a formula down to plain text.

import { flattenTex } from "./math-flatten"

/** Alternating literal and maths, so one pass does both forms. */
const SEGMENT = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g

export type MathPiece = { kind: "text" | "math"; value: string; display: boolean }

export function splitMath(source: string): MathPiece[] {
  return source
    .split(SEGMENT)
    .filter((s) => s !== "")
    .map((s) => {
      if (s.startsWith("$$") && s.endsWith("$$") && s.length > 4) {
        return { kind: "math" as const, value: s.slice(2, -2), display: true }
      }
      if (s.startsWith("$") && s.endsWith("$") && s.length > 2) {
        return { kind: "math" as const, value: s.slice(1, -1), display: false }
      }
      return { kind: "text" as const, value: s, display: false }
    })
}

/**
 * The same text with the maths read out flat, for one-line rows.
 *
 * A deck table row is 13px and truncated with an ellipsis, and a rendered fraction inside one
 * is a two-storey object in a one-storey space that pushes the line height of every row around
 * it. Stripping only the `$` is worse than useless, a row reading `-90\,\text{mV}` is noisier
 * than the formula it stands for. What a row wants is how you would say it out loud:
 * `-90 mV`, `RT/zF`, `Vₘₐₓ`. Approximate on purpose, and never shown anywhere you would work
 * from it.
 */
export function stripMath(source: string): string {
  return source
    .replace(SEGMENT, (m) => flattenTex(m.replace(/^\$\$?|\$\$?$/g, "")))
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}
