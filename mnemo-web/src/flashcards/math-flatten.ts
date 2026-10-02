// Reads a LaTeX formula out as one line of plain text: Greek letters and operators become
// their symbols, sub and superscripts drop to the Unicode forms where every character has
// one, and structure such as a fraction becomes how you would say it.

const SYMBOLS: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ",
  eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν",
  xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ", varphi: "φ",
  chi: "χ", psi: "ψ", omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ",
  Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  cdot: "·", times: "×", div: "÷", pm: "±", mp: "∓", approx: "≈", sim: "~", equiv: "≡",
  neq: "≠", ne: "≠", leq: "≤", le: "≤", geq: "≥", ge: "≥", lt: "<", gt: ">", propto: "∝",
  infty: "∞", partial: "∂", nabla: "∇", sum: "Σ", prod: "Π", int: "∫", in: "∈",
  to: "→", rightarrow: "→", leftarrow: "←", Rightarrow: "⇒", leftrightarrow: "↔",
  degree: "°", circ: "∘", ldots: "…", cdots: "…", dots: "…",
}

const SUBSCRIPT: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ",
  l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ", p: "ₚ", r: "ᵣ", s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ",
}

const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ", "°": "°",
  // A raised composition ring is how LaTeX writes a degree sign.
  "∘": "°",
}

/** A script as raised or lowered characters when every one has a form, else marked plainly. */
function script(body: string, map: Record<string, string>, mark: string): string {
  const chars = [...body]
  if (chars.length > 0 && chars.every((c) => c in map)) return chars.map((c) => map[c]).join("")
  return chars.length > 1 ? `${mark}(${body})` : `${mark}${body}`
}

type Rule = [RegExp, (...groups: string[]) => string]

const STRUCTURE: Rule[] = [
  [/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_, top, bottom) => `${top}/${bottom}`],
  [/\\(?:text|mathrm|mathbf|mathit|operatorname)\s*\{([^{}]*)\}/g, (_, body) => body],
  [/\\sqrt\s*\{([^{}]*)\}/g, (_, body) => ([...body].length > 1 ? `√(${body})` : `√${body}`)],
]

// Run once, after the structure has settled: a fallback like "_(cat)" must not be read again as
// a script of its own opening bracket.
const SCRIPTS: Rule[] = [
  [/_\s*\{([^{}]*)\}|_\s*([^\s{}\\])/g, (_, braced, bare) => script(braced ?? bare, SUBSCRIPT, "_")],
  [/\^\s*\{([^{}]*)\}|\^\s*([^\s{}\\])/g, (_, braced, bare) => script(braced ?? bare, SUPERSCRIPT, "^")],
]

export function flattenTex(tex: string): string {
  let out = tex
    .replace(/\\(?:quad|qquad|,|;|:|!)/g, " ")
    // Whole commands only, so the arrows that share the prefix keep their names.
    .replace(/\\(?:left|right)(?![a-zA-Z])/g, "")
    .replace(/\\([a-zA-Z]+)/g, (whole, name: string) => SYMBOLS[name] ?? whole)
  // Repeated because a fraction can hold a fraction, and one pass only reaches the inner one.
  for (let pass = 0; pass < 3; pass += 1) {
    for (const [re, to] of STRUCTURE) out = out.replace(re, to)
  }
  for (const [re, to] of SCRIPTS) out = out.replace(re, to)
  // Anything still carrying a backslash is a named thing, ln, log, sin. The word is the
  // readable part, the backslash never was.
  return out.replace(/\\([a-zA-Z]+)/g, "$1").replace(/[{}]/g, "")
}
