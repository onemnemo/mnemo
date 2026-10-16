/** A code block caption in markdown, written as `caption="..."` at the end of the fence info. The host's `CodeFenceInfo` uses the same form. */

export interface CodeFenceInfo {
  /** The text before the caption, usually the language. */
  readonly head: string;
  readonly caption: string;
}

const TRAILING_CAPTION = /^(.*?)(?:^|\s)caption="((?:[^"\\]|\\.)*)"$/;
const ESCAPES = /\\(\\|"|u0060)/g;

export function formatCodeFenceInfo(language: string, caption: string): string {
  const head = language.trim();
  const text = caption.replace(/[\r\n]+/g, ' ').trim();
  if (text === '') return head;
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('`', '\\u0060');
  return `${head}${head === '' ? '' : ' '}caption="${escaped}"`;
}

export function parseCodeFenceInfo(info: string): CodeFenceInfo {
  const match = TRAILING_CAPTION.exec(info.trim());
  if (!match) return { head: info.trim(), caption: '' };
  const caption = match[2].replace(ESCAPES, (_all, escape: string) => (escape === 'u0060' ? '`' : escape));
  return { head: match[1].trim(), caption };
}
