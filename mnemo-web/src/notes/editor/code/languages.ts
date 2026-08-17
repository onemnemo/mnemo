/**
 * The language list the code block's picker offers.
 *
 * Deliberately longer than the set of grammars the highlighter actually knows.
 * Choosing Kotlin and getting C-like colouring plus the right label on the block
 * is a better answer than not being able to say the snippet is Kotlin at all.
 *
 * Values are stable tokens, not display strings: they are what a note stores, so
 * renaming a label must never rewrite saved blocks.
 */

export interface CodeLanguage {
  readonly value: string;
  readonly label: string;
}

export const codeLanguages: readonly CodeLanguage[] = Object.freeze([
  { value: 'text', label: 'Plain text' },
  { value: 'bash', label: 'Bash' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'csharp', label: 'C#' },
  { value: 'css', label: 'CSS' },
  { value: 'dart', label: 'Dart' },
  { value: 'diff', label: 'Diff' },
  { value: 'elixir', label: 'Elixir' },
  { value: 'go', label: 'Go' },
  { value: 'graphql', label: 'GraphQL' },
  { value: 'haskell', label: 'Haskell' },
  { value: 'html', label: 'HTML' },
  { value: 'java', label: 'Java' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'json', label: 'JSON' },
  { value: 'julia', label: 'Julia' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'latex', label: 'LaTeX' },
  { value: 'lua', label: 'Lua' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'matlab', label: 'MATLAB' },
  { value: 'objectivec', label: 'Objective-C' },
  { value: 'perl', label: 'Perl' },
  { value: 'php', label: 'PHP' },
  { value: 'powershell', label: 'PowerShell' },
  { value: 'python', label: 'Python' },
  { value: 'r', label: 'R' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'rust', label: 'Rust' },
  { value: 'scala', label: 'Scala' },
  { value: 'sql', label: 'SQL' },
  { value: 'swift', label: 'Swift' },
  { value: 'toml', label: 'TOML' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'verilog', label: 'Verilog' },
  { value: 'vhdl', label: 'VHDL' },
  { value: 'xml', label: 'XML' },
  { value: 'yaml', label: 'YAML' },
]);

const byValue = new Map(codeLanguages.map((language) => [language.value, language]));

/**
 * The label for a stored value, falling back to the value itself.
 *
 * A note written by a future build (or imported from elsewhere) can name a
 * language this list has never heard of. Showing that raw token keeps the block
 * honest about what it holds; claiming it is plain text would not.
 */
export function codeLanguageLabel(value: string): string {
  return byValue.get(value)?.label ?? (value.length > 0 ? value : 'Plain text');
}
