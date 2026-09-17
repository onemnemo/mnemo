/**
 * The characters the `\` palette offers, keyed by their LaTeX names.
 *
 * LaTeX because it is self-documenting and the vocabulary students already
 * have, and because the same name works inside an equation atom, so one
 * habit serves both. Names are not translated; the English aliases are the
 * everyday words a name is looked up by and feed search only, the way the
 * emoji picker's keywords do.
 *
 * Only characters with no mark equivalent belong here. Superscript and
 * subscript are marks, written with `^` and `_`, and a palette entry for a
 * raised digit would be a second, worse way to do the same thing.
 *
 * The two dashes and the no-break space are spelled as escapes: the
 * repository's own text never carries a dash, this being the one place a
 * user's document may, and an invisible character is no use as a literal.
 */

export type SymbolGroup =
  | 'greek'
  | 'operators'
  | 'relations'
  | 'arrows'
  | 'fractions'
  | 'currency'
  | 'typography';

export interface SymbolEntry {
  /** The LaTeX name after the backslash, what the palette is searched by and recents are stored under. */
  readonly name: string;
  readonly char: string;
  readonly group: SymbolGroup;
  /** Everyday words the name is looked up by. */
  readonly aliases: readonly string[];
}

/** Section heading keys in the `NotesEditor` namespace, in the order the groups are drawn. */
export const SYMBOL_GROUP_LABEL_KEY: Readonly<Record<SymbolGroup | 'recent', string>> = {
  recent: 'SymbolGroupRecent',
  greek: 'SymbolGroupGreek',
  operators: 'SymbolGroupOperators',
  relations: 'SymbolGroupRelations',
  arrows: 'SymbolGroupArrows',
  fractions: 'SymbolGroupFractions',
  currency: 'SymbolGroupCurrency',
  typography: 'SymbolGroupTypography',
};

function entries(group: SymbolGroup, rows: readonly [string, string, ...string[]][]): SymbolEntry[] {
  return rows.map(([name, char, ...aliases]) => ({ name, char, group, aliases }));
}

const GREEK = entries('greek', [
  ['alpha', 'α'],
  ['beta', 'β'],
  ['gamma', 'γ'],
  ['delta', 'δ'],
  ['epsilon', 'ϵ', 'lunate epsilon'],
  ['varepsilon', 'ε', 'epsilon'],
  ['zeta', 'ζ'],
  ['eta', 'η'],
  ['theta', 'θ'],
  ['vartheta', 'ϑ', 'theta'],
  ['iota', 'ι'],
  ['kappa', 'κ'],
  ['varkappa', 'ϰ', 'kappa'],
  ['lambda', 'λ'],
  ['mu', 'μ', 'micro'],
  ['nu', 'ν'],
  ['xi', 'ξ'],
  ['omicron', 'ο'],
  ['pi', 'π'],
  ['varpi', 'ϖ', 'pi'],
  ['rho', 'ρ'],
  ['varrho', 'ϱ', 'rho'],
  ['sigma', 'σ'],
  ['varsigma', 'ς', 'sigma', 'final sigma'],
  ['tau', 'τ'],
  ['upsilon', 'υ'],
  ['phi', 'ϕ', 'straight phi'],
  ['varphi', 'φ', 'phi'],
  ['chi', 'χ'],
  ['psi', 'ψ'],
  ['omega', 'ω'],
  ['Gamma', 'Γ'],
  ['Delta', 'Δ', 'change', 'difference'],
  ['Theta', 'Θ'],
  ['Lambda', 'Λ'],
  ['Xi', 'Ξ'],
  ['Pi', 'Π', 'product'],
  ['Sigma', 'Σ', 'sum'],
  ['Upsilon', 'Υ'],
  ['Phi', 'Φ'],
  ['Psi', 'Ψ'],
  ['Omega', 'Ω', 'ohm'],
]);

const OPERATORS = entries('operators', [
  ['sum', '∑', 'sigma', 'summation'],
  ['prod', '∏', 'product'],
  ['coprod', '∐', 'coproduct'],
  ['int', '∫', 'integral'],
  ['iint', '∬', 'double integral'],
  ['iiint', '∭', 'triple integral'],
  ['oint', '∮', 'contour integral', 'closed integral'],
  ['sqrt', '√', 'square root', 'radical'],
  ['infty', '∞', 'infinity', 'inf'],
  ['partial', '∂', 'partial derivative', 'del'],
  ['nabla', '∇', 'gradient', 'del'],
  ['pm', '±', 'plus minus', 'plus or minus'],
  ['mp', '∓', 'minus plus'],
  ['minus', '−', 'minus sign'],
  ['times', '×', 'multiply', 'cross'],
  ['div', '÷', 'divide', 'division'],
  ['cdot', '⋅', 'dot', 'multiply'],
  ['circ', '∘', 'compose', 'ring', 'composition'],
  ['bullet', '∙', 'dot operator'],
  ['ast', '∗', 'asterisk', 'star'],
  ['star', '⋆', 'star'],
  ['degree', '°', 'degrees', 'deg'],
  ['prime', '′', 'derivative', 'minute'],
  ['dprime', '″', 'double prime', 'second'],
  ['oplus', '⊕', 'direct sum', 'xor', 'circled plus'],
  ['ominus', '⊖', 'circled minus'],
  ['otimes', '⊗', 'tensor', 'circled times'],
  ['odot', '⊙', 'circled dot'],
  ['cup', '∪', 'union'],
  ['cap', '∩', 'intersection'],
  ['bigcup', '⋃', 'union'],
  ['bigcap', '⋂', 'intersection'],
  ['setminus', '∖', 'set minus', 'difference'],
  ['wedge', '∧', 'and', 'meet'],
  ['vee', '∨', 'or', 'join'],
  ['perp', '⊥', 'perpendicular', 'bottom', 'bot'],
  ['top', '⊤', 'top', 'true'],
  ['parallel', '∥', 'parallel'],
  ['mid', '∣', 'divides', 'such that'],
  ['nmid', '∤', 'does not divide'],
  ['angle', '∠'],
  ['triangle', '△'],
  ['square', '□', 'box', 'qed'],
  ['diamond', '⋄'],
  ['langle', '⟨', 'left angle bracket', 'bra'],
  ['rangle', '⟩', 'right angle bracket', 'ket'],
  ['lceil', '⌈', 'left ceiling'],
  ['rceil', '⌉', 'right ceiling'],
  ['lfloor', '⌊', 'left floor'],
  ['rfloor', '⌋', 'right floor'],
]);

const RELATIONS = entries('relations', [
  ['neq', '≠', 'not equal', 'ne'],
  ['leq', '≤', 'less than or equal', 'le'],
  ['geq', '≥', 'greater than or equal', 'ge'],
  ['ll', '≪', 'much less than'],
  ['gg', '≫', 'much greater than'],
  ['lesssim', '≲', 'less than or similar'],
  ['gtrsim', '≳', 'greater than or similar'],
  ['approx', '≈', 'approximately', 'almost equal'],
  ['equiv', '≡', 'equivalent', 'identical', 'congruent modulo'],
  ['sim', '∼', 'similar', 'tilde', 'distributed as'],
  ['simeq', '≃', 'asymptotically equal'],
  ['cong', '≅', 'congruent', 'isomorphic'],
  ['propto', '∝', 'proportional'],
  ['in', '∈', 'element of', 'member'],
  ['notin', '∉', 'not element of', 'not member'],
  ['ni', '∋', 'contains', 'owns'],
  ['subset', '⊂', 'proper subset'],
  ['subseteq', '⊆', 'subset or equal'],
  ['subsetneq', '⊊', 'proper subset'],
  ['supset', '⊃', 'superset'],
  ['supseteq', '⊇', 'superset or equal'],
  ['nsubseteq', '⊈', 'not subset'],
  ['sqsubseteq', '⊑', 'square subset'],
  ['sqsupseteq', '⊒', 'square superset'],
  ['emptyset', '∅', 'empty set', 'null set', 'varnothing'],
  ['forall', '∀', 'for all', 'universal'],
  ['exists', '∃', 'there exists', 'existential'],
  ['nexists', '∄', 'does not exist'],
  ['neg', '¬', 'not', 'negation', 'lnot'],
  ['land', '∧', 'and', 'conjunction'],
  ['lor', '∨', 'or', 'disjunction'],
  ['implies', '⇒', 'implies', 'then'],
  ['iff', '⇔', 'if and only if', 'equivalent'],
  ['therefore', '∴', 'therefore', 'hence'],
  ['because', '∵', 'because', 'since'],
  ['vdash', '⊢', 'proves', 'turnstile'],
  ['models', '⊨', 'models', 'entails', 'double turnstile'],
  ['prec', '≺', 'precedes'],
  ['succ', '≻', 'succeeds'],
]);

const ARROWS = entries('arrows', [
  ['to', '→', 'right arrow', 'rightarrow', 'maps to', 'tends to'],
  ['gets', '←', 'left arrow', 'leftarrow', 'assign'],
  ['leftrightarrow', '↔', 'both ways', 'left right arrow'],
  ['uparrow', '↑', 'up arrow', 'increase'],
  ['downarrow', '↓', 'down arrow', 'decrease'],
  ['updownarrow', '↕', 'up down arrow'],
  ['nearrow', '↗', 'north east arrow', 'diagonal'],
  ['searrow', '↘', 'south east arrow', 'diagonal'],
  ['nwarrow', '↖', 'north west arrow', 'diagonal'],
  ['swarrow', '↙', 'south west arrow', 'diagonal'],
  ['Rightarrow', '⇒', 'double right arrow', 'implies'],
  ['Leftarrow', '⇐', 'double left arrow', 'implied by'],
  ['Leftrightarrow', '⇔', 'double arrow', 'iff', 'equivalent'],
  ['Uparrow', '⇑', 'double up arrow'],
  ['Downarrow', '⇓', 'double down arrow'],
  ['mapsto', '↦', 'maps to', 'function'],
  ['longrightarrow', '⟶', 'long right arrow'],
  ['longleftarrow', '⟵', 'long left arrow'],
  ['longleftrightarrow', '⟷', 'long left right arrow'],
  ['Longrightarrow', '⟹', 'long double right arrow', 'implies'],
  ['Longleftrightarrow', '⟺', 'long double arrow', 'iff'],
  ['hookrightarrow', '↪', 'hook right arrow', 'injection', 'embedding'],
  ['hookleftarrow', '↩', 'hook left arrow'],
  ['twoheadrightarrow', '↠', 'two headed arrow', 'surjection'],
  ['rightharpoonup', '⇀', 'right harpoon', 'vector'],
  ['leftharpoonup', '↼', 'left harpoon'],
  ['rightleftharpoons', '⇌', 'equilibrium', 'reversible', 'harpoons'],
  ['leadsto', '⇝', 'leads to', 'squiggle arrow'],
]);

const FRACTIONS = entries('fractions', [
  ['1/2', '½', 'half', 'fraction'],
  ['1/3', '⅓', 'third', 'fraction'],
  ['2/3', '⅔', 'two thirds', 'fraction'],
  ['1/4', '¼', 'quarter', 'fraction'],
  ['3/4', '¾', 'three quarters', 'fraction'],
  ['1/8', '⅛', 'eighth', 'fraction'],
  ['3/8', '⅜', 'three eighths', 'fraction'],
  ['5/8', '⅝', 'five eighths', 'fraction'],
  ['7/8', '⅞', 'seven eighths', 'fraction'],
  ['ell', 'ℓ', 'script l', 'litre', 'length'],
  ['hbar', 'ℏ', 'reduced planck constant', 'h bar'],
  ['aleph', 'ℵ', 'aleph', 'cardinal'],
  ['Re', 'ℜ', 'real part'],
  ['Im', 'ℑ', 'imaginary part'],
  ['wp', '℘', 'weierstrass p'],
  ['N', 'ℕ', 'natural numbers', 'mathbb N', 'naturals'],
  ['Z', 'ℤ', 'integers', 'mathbb Z'],
  ['Q', 'ℚ', 'rational numbers', 'mathbb Q', 'rationals'],
  ['R', 'ℝ', 'real numbers', 'mathbb R', 'reals'],
  ['C', 'ℂ', 'complex numbers', 'mathbb C'],
  ['P', 'ℙ', 'probability', 'primes', 'mathbb P'],
]);

const CURRENCY = entries('currency', [
  ['euro', '€', 'eur', 'euros'],
  ['pound', '£', 'gbp', 'pounds', 'sterling'],
  ['yen', '¥', 'jpy', 'yuan'],
  ['cent', '¢', 'cents'],
  ['won', '₩', 'krw'],
  ['rupee', '₹', 'inr'],
  ['franc', '₣'],
  ['bitcoin', '₿', 'btc'],
]);

const TYPOGRAPHY = entries('typography', [
  ['dots', '…', 'ellipsis', 'ldots', 'three dots'],
  ['cdots', '⋯', 'centered dots', 'midline ellipsis'],
  ['vdots', '⋮', 'vertical dots'],
  ['ddots', '⋱', 'diagonal dots'],
  ['copyright', '©', 'copyright sign'],
  ['registered', '®', 'registered trademark'],
  ['trademark', '™', 'tm'],
  ['endash', '\u2013', 'en dash', 'range dash', 'ndash'],
  ['emdash', '\u2014', 'em dash', 'mdash'],
  ['section', '§', 'section sign', 'S'],
  ['pilcrow', '¶', 'paragraph sign', 'P'],
  ['dagger', '†', 'footnote', 'obelisk'],
  ['ddagger', '‡', 'double dagger', 'diesis'],
  ['textbullet', '•', 'bullet point', 'list dot'],
  ['lq', '‘', 'left single quote', 'open quote'],
  ['rq', '’', 'right single quote', 'close quote', 'apostrophe'],
  ['checkmark', '✓', 'check', 'tick', 'done'],
  ['permil', '‰', 'per mille', 'per thousand', 'promille'],
  ['micro', 'µ', 'micro sign', 'mu'],
  ['textcelsius', '℃', 'celsius', 'degrees celsius'],
  ['ohm', 'Ω', 'ohm sign', 'resistance'],
  ['nbsp', '\u00a0', 'non breaking space', 'no break space'],
]);

export const SYMBOL_CATALOG: readonly SymbolEntry[] = Object.freeze([
  ...GREEK,
  ...OPERATORS,
  ...RELATIONS,
  ...ARROWS,
  ...FRACTIONS,
  ...CURRENCY,
  ...TYPOGRAPHY,
]);
