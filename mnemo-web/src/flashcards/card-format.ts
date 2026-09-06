import { splitMath } from "./math"

// The grammar the card editor's format bar writes, and nothing else: `**bold**`, `*italic*`,
// `__underline__`, `` `code` ``, `==highlight==`, and a line opening with `- ` as a bullet.
//
// A general markdown parser is the wrong tool for it. CommonMark reads `__x__` as strong rather
// than underline and has no `==x==` at all, so it would misread the bar's own output on cards
// people have already saved. Kept free of React so the parse is testable on its own.

export type CardMark = "bold" | "italic" | "underline" | "code" | "highlight"

export type CardInline =
  | { kind: "text"; value: string }
  | { kind: "math"; value: string; display: boolean }
  | { kind: "mark"; mark: CardMark; children: CardInline[] }

export type CardBlock =
  | { kind: "text"; content: CardInline[] }
  | { kind: "list"; items: CardInline[][] }

/** Longest first, so `**` is never read as two italics. */
const MARKERS: [string, CardMark][] = [
  ["**", "bold"],
  ["__", "underline"],
  ["==", "highlight"],
  ["*", "italic"],
  ["`", "code"],
]

const BULLET = /^[ \t]*- (.*)$/

const WHITESPACE = /\s/

/**
 * One character of the source, or one whole formula.
 *
 * A formula stands in as a single non-space character so a marker pressed against one counts as
 * flanked by content, which is what makes `**$E=mc^2$**` bold rather than four stray asterisks.
 */
type Unit = { char: string; math?: { value: string; display: boolean } }

const MATH_UNIT = "\uE000"

type Token =
  | { t: "text"; value: string }
  | { t: "math"; value: string; display: boolean }
  | { t: "delim"; marker: string; mark: CardMark; opens: boolean; closes: boolean }

function unitsOf(source: string): Unit[] {
  const units: Unit[] = []
  for (const piece of splitMath(source)) {
    if (piece.kind === "math") {
      units.push({ char: MATH_UNIT, math: { value: piece.value, display: piece.display } })
      continue
    }
    for (const char of piece.value) units.push({ char })
  }
  return units
}

function markerAt(units: Unit[], at: number): [string, CardMark] | null {
  for (const [marker, mark] of MARKERS) {
    let matched = true
    for (let i = 0; i < marker.length; i += 1) {
      const unit = units[at + i]
      if (!unit || unit.math || unit.char !== marker[i]) {
        matched = false
        break
      }
    }
    if (matched) return [marker, mark]
  }
  return null
}

function pushText(tokens: Token[], value: string): void {
  const last = tokens[tokens.length - 1]
  if (last?.t === "text") last.value += value
  else tokens.push({ t: "text", value })
}

/**
 * Splits the run into text, formulas and marker delimiters.
 *
 * A delimiter records whether it may open or close rather than being paired here: a marker with
 * a space on the inside is arithmetic or punctuation, not formatting, which is the only thing
 * that keeps `5 * 3 * 2` and `a == b == c` from swallowing their middles.
 */
function tokenize(units: Unit[]): Token[] {
  const tokens: Token[] = []
  let at = 0
  while (at < units.length) {
    const found = markerAt(units, at)
    if (found) {
      const [marker, mark] = found
      const before = units[at - 1]
      const after = units[at + marker.length]
      tokens.push({
        t: "delim",
        marker,
        mark,
        opens: after !== undefined && !WHITESPACE.test(after.char),
        closes: before !== undefined && !WHITESPACE.test(before.char),
      })
      at += marker.length
      continue
    }
    const unit = units[at]
    if (unit.math) tokens.push({ t: "math", value: unit.math.value, display: unit.math.display })
    else pushText(tokens, unit.char)
    at += 1
  }
  return tokens
}

function findClose(tokens: Token[], from: number, marker: string): number {
  for (let i = from; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (token.t === "delim" && token.marker === marker && token.closes) return i
  }
  return -1
}

/** The source these tokens were read from, for a code span, where a marker is part of the quote. */
function sourceOf(tokens: Token[]): string {
  return tokens
    .map((token) => {
      if (token.t === "text") return token.value
      if (token.t === "delim") return token.marker
      return token.display ? `$$${token.value}$$` : `$${token.value}$`
    })
    .join("")
}

function appendText(nodes: CardInline[], value: string): void {
  const last = nodes[nodes.length - 1]
  if (last?.kind === "text") last.value += value
  else nodes.push({ kind: "text", value })
}

function pairMarks(tokens: Token[]): CardInline[] {
  const nodes: CardInline[] = []
  let at = 0
  while (at < tokens.length) {
    const token = tokens[at]
    if (token.t === "text") {
      appendText(nodes, token.value)
      at += 1
      continue
    }
    if (token.t === "math") {
      nodes.push({ kind: "math", value: token.value, display: token.display })
      at += 1
      continue
    }

    const close = token.opens ? findClose(tokens, at + 1, token.marker) : -1
    // An empty pair is two markers the writer left behind, so it stays on screen as typed.
    if (close > at + 1) {
      const inner = tokens.slice(at + 1, close)
      nodes.push({
        kind: "mark",
        mark: token.mark,
        children: token.mark === "code" ? [{ kind: "text", value: sourceOf(inner) }] : pairMarks(inner),
      })
      at = close + 1
      continue
    }
    appendText(nodes, token.marker)
    at += 1
  }
  return nodes
}

function parseInline(source: string): CardInline[] {
  return pairMarks(tokenize(unitsOf(source)))
}

/**
 * Card text as blocks to render.
 *
 * Text keeps its newlines: the surfaces lay it out with `white-space: pre-wrap`, so a run of
 * plain text has to reach them as one string or every card gains line breaks it never had.
 * Only a bullet run is lifted out into a list of its own.
 */
export function parseCardText(source: string): CardBlock[] {
  const text = source ?? ""
  const lines = text.split("\n")
  const items = lines.map((line) => BULLET.exec(line)?.[1] ?? null)
  if (items.every((item) => item === null)) return [{ kind: "text", content: parseInline(text) }]

  const blocks: CardBlock[] = []
  let run: string[] = []

  const flush = () => {
    const joined = run.join("\n")
    run = []
    // Blank lines around a list are what separated it from the text before the list existed.
    if (joined.trim()) blocks.push({ kind: "text", content: parseInline(joined) })
  }

  for (let i = 0; i < lines.length; i += 1) {
    const item = items[i]
    if (item === null) {
      run.push(lines[i])
      continue
    }
    flush()
    const last = blocks[blocks.length - 1]
    if (last?.kind === "list") last.items.push(parseInline(item))
    else blocks.push({ kind: "list", items: [parseInline(item)] })
  }
  flush()

  return blocks
}
