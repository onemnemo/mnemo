/**
 * The plain words a run of inline spans spells.
 *
 * The same projection the server writes into `text` when it stores runs, kept in step by test so a
 * label the client flattens for a comparison or a thumbnail reads the way the stored text does: an
 * equation as its LaTeX, a fraction as `n/d`, text as itself. Not the caret arithmetic flatten, which
 * stands an atom in for one placeholder character.
 */

import type { InlineSpan } from "@/notes/model/types"

export function flattenRuns(runs: readonly InlineSpan[]): string {
  let out = ""
  for (const run of runs) {
    switch (run.kind) {
      case "text":
        out += run.text
        break
      case "equation":
        out += run.latex
        break
      case "fraction":
        out += `${run.numerator}/${run.denominator}`
        break
    }
  }
  return out
}

/** One unstyled run holding the words, for a label that has never been formatted. */
export function plainRuns(text: string): InlineSpan[] {
  return [{ kind: "text", text, style: { ...defaultStyle } }]
}

/**
 * Whether two labels spell the same runs, which is what decides that an edit changed nothing.
 * Structural rather than by reference: the editor hands back fresh objects on every read.
 */
export function sameRuns(a: readonly InlineSpan[], b: readonly InlineSpan[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  for (let index = 0; index < a.length; index += 1) {
    if (!sameRun(a[index], b[index])) {
      return false
    }
  }
  return true
}

/**
 * One string per distinct run list, for a cache or an effect keyed on the runs rather than on their
 * object identity. Field by field in a fixed order, so two lists that spell the same runs key the
 * same whatever order their fields were written in and whichever fields were left at the default.
 */
export function runsKey(runs: readonly InlineSpan[]): string {
  let out = ""
  for (const run of runs) {
    switch (run.kind) {
      case "text":
        out += `t${run.text.length}:${run.text}`
        break
      case "equation":
        out += `e${run.latex.length}:${run.latex}`
        break
      case "fraction":
        out += `f${run.numerator}/${run.denominator}`
        break
    }
    for (const key of Object.keys(defaultStyle) as (keyof typeof defaultStyle)[]) {
      const value = run.style[key] ?? defaultStyle[key]
      if (value !== defaultStyle[key]) {
        out += `|${key}=${String(value)}`
      }
    }
    out += ";"
  }
  return out
}

function sameRun(a: InlineSpan, b: InlineSpan): boolean {
  if (a.kind !== b.kind || !sameStyle(a.style, b.style)) {
    return false
  }
  switch (a.kind) {
    case "text":
      return a.text === (b as typeof a).text
    case "equation":
      return a.latex === (b as typeof a).latex
    case "fraction":
      return a.numerator === (b as typeof a).numerator && a.denominator === (b as typeof a).denominator
  }
}

function sameStyle(a: InlineSpan["style"], b: InlineSpan["style"]): boolean {
  for (const key of Object.keys(defaultStyle) as (keyof typeof defaultStyle)[]) {
    if ((a[key] ?? defaultStyle[key]) !== (b[key] ?? defaultStyle[key])) {
      return false
    }
  }
  return true
}

const defaultStyle: InlineSpan["style"] = {
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  code: false,
  highlight: false,
  backgroundColor: null,
  foregroundColor: null,
  linkUrl: null,
  suppressAutoLink: false,
  subscript: false,
  superscript: false,
}
