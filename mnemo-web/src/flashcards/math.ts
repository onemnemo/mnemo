// Splitting for card text that carries LaTeX: `$…$` inline and `$$…$$` on its own line.
//
// Kept apart from CardText.tsx so the deck table, which never renders KaTeX, does not load it.
//
// The C# twin is CardMath.cs. Both share the vectors in math-split.json.

import { flattenTex } from "./math-flatten"

export type MathPiece = { kind: "text" | "math"; value: string; display: boolean }

/** Space, tab, and the no-break and thin spaces some languages put before a currency sign. */
const SPACE = " \t\u00a0\u202f\u2009"
const isSpace = (c: string | undefined) => c !== undefined && SPACE.includes(c)
const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9"
const TEX_SIGNAL = /[\\^{}]/

/** End of a `$$…$$` block opening at `at`, or -1. Blocks may span lines. */
function displayEnd(source: string, at: number): number {
  for (let i = at + 3; i < source.length - 1; i += 1) {
    if (source[i] === "\\") i += 1
    else if (source[i] === "$" && source[i + 1] === "$") return i + 2
  }
  return -1
}

/**
 * End of a `$…$` formula opening at `at`, or -1. The pair closes at the next unescaped dollar
 * on the line. A body with TeX (`\`, `^`, `{`, `}`) is maths. A tight body (`$x^2$`) is maths
 * unless it starts with a digit and a digit follows, as in `$5-$10`. A body opening with a
 * space (`$ x $`) is maths unless a digit comes before, as in `5 $ and 7 $`. A body of only
 * spaces, or one that only ends in a space, is not maths.
 */
function inlineEnd(source: string, at: number): number {
  let close = -1
  for (let i = at + 1; i < source.length; i += 1) {
    const c = source[i]
    if (c === "\n") return -1
    if (c === "\\" && source[i + 1] !== undefined && source[i + 1] !== "\n") i += 1
    else if (c === "$") {
      close = i
      break
    }
  }
  if (close === -1) return -1
  const body = source.slice(at + 1, close)
  if ([...body].every(isSpace)) return -1
  if (TEX_SIGNAL.test(body)) return close + 1
  if (isSpace(body[0])) {
    let before = at - 1
    while (isSpace(source[before])) before -= 1
    return isDigit(source[before]) ? -1 : close + 1
  }
  if (isSpace(body[body.length - 1])) return -1
  return isDigit(body[0]) && isDigit(source[close + 1]) ? -1 : close + 1
}

/** Alternating literal and maths runs. A backslash dollar is a literal dollar. */
export function splitMath(source: string): MathPiece[] {
  const pieces: MathPiece[] = []
  let text = ""
  const flush = () => {
    if (text !== "") pieces.push({ kind: "text", value: text, display: false })
    text = ""
  }
  let i = 0
  while (i < source.length) {
    const c = source[i]
    if (c === "\\" && i + 1 < source.length) {
      text += source[i + 1] === "$" ? "$" : c + source[i + 1]
      i += 2
      continue
    }
    if (c === "$") {
      const display = source[i + 1] === "$" ? displayEnd(source, i) : -1
      const end = display === -1 ? inlineEnd(source, i) : display
      if (end !== -1) {
        flush()
        const fence = display === -1 ? 1 : 2
        pieces.push({ kind: "math", value: source.slice(i + fence, end - fence), display: display !== -1 })
        i = end
        continue
      }
    }
    text += c
    i += 1
  }
  flush()
  return pieces
}

/** One formula read out flat. */
export function flattenMath(value: string): string {
  return flattenTex(value).replace(/[ \t]{2,}/g, " ").trim()
}
