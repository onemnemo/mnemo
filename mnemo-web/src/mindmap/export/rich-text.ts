/**
 * A formatted label's runs, cut along the lines the projector wrapped its plain words into.
 *
 * The export draws text a line at a time, and the lines it has are the greedy wrap of the flattened
 * text: whitespace collapsed, words joined by single spaces, a word too long for the ceiling broken
 * mid-word. The runs know nothing about lines. So this walks the two together, one character at a
 * time, handing each character of a line the style of the run it came from, and folds neighbours of
 * one style back into fragments. The picture is an approximation of the browser's wrap, as it
 * already is for a plain label.
 *
 * An atom is spelled as its plain projection, an equation as its source and a fraction as `n/d`,
 * since a rendering cannot leave the app, and marked as one so the export can set it apart.
 */

import type { InlineSpan, TextStyle } from "@/notes/model/types"

export interface Fragment {
  readonly text: string
  readonly bold: boolean
  readonly italic: boolean
  readonly underline: boolean
  readonly strike: boolean
  readonly code: boolean
  readonly subscript: boolean
  readonly superscript: boolean
  /** The swatch token a colour was chosen from, when one was. */
  readonly swatch: string | null
  readonly link: boolean
}

interface StyledChar {
  readonly char: string
  readonly style: Omit<Fragment, "text">
}

export function sliceRuns(runs: readonly InlineSpan[], lines: readonly string[]): Fragment[][] {
  const source = charsOf(runs)
  let at = 0

  return lines.map((line) => {
    const chars: StyledChar[] = []
    for (const char of line) {
      if (isSpace(char)) {
        // One space in a line stands for a whole run of whitespace in the source.
        const style = at < source.length ? source[at].style : PLAIN
        while (at < source.length && isSpace(source[at].char)) {
          at += 1
        }
        chars.push({ char, style })
        continue
      }
      while (at < source.length && isSpace(source[at].char)) {
        at += 1
      }
      // Every word character of a line is a character of the source, in order. Anything else is a
      // line that did not come from these runs, drawn plain rather than dropped.
      const next = at < source.length ? source[at] : null
      if (next && next.char === char) {
        at += 1
        chars.push(next)
      } else {
        chars.push({ char, style: PLAIN })
      }
    }
    return fold(chars)
  })
}

const PLAIN: Omit<Fragment, "text"> = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  code: false,
  subscript: false,
  superscript: false,
  swatch: null,
  link: false,
}

function charsOf(runs: readonly InlineSpan[]): StyledChar[] {
  const out: StyledChar[] = []
  for (const run of runs) {
    const style = styleOf(run.style, run.kind !== "text")
    const text =
      run.kind === "text"
        ? run.text
        : run.kind === "equation"
          ? run.latex
          : `${String(run.numerator)}/${String(run.denominator)}`
    for (const char of text) {
      out.push({ char, style })
    }
  }
  return out
}

/** An atom reads in italic, the way a math node always exported. */
function styleOf(style: TextStyle, atom: boolean): Omit<Fragment, "text"> {
  return {
    bold: style.bold,
    italic: style.italic || atom,
    underline: style.underline,
    strike: style.strikethrough,
    code: style.code,
    subscript: style.subscript,
    superscript: style.superscript,
    swatch: style.foregroundColor || null,
    link: style.linkUrl !== null && style.linkUrl !== "",
  }
}

function fold(chars: readonly StyledChar[]): Fragment[] {
  const out: Fragment[] = []
  for (const { char, style } of chars) {
    const last = out[out.length - 1]
    if (last && sameStyle(last, style)) {
      out[out.length - 1] = { ...last, text: last.text + char }
    } else {
      out.push({ ...style, text: char })
    }
  }
  return out
}

function sameStyle(a: Omit<Fragment, "text">, b: Omit<Fragment, "text">): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strike === b.strike &&
    a.code === b.code &&
    a.subscript === b.subscript &&
    a.superscript === b.superscript &&
    a.swatch === b.swatch &&
    a.link === b.link
  )
}

function isSpace(char: string): boolean {
  return /\s/.test(char)
}
