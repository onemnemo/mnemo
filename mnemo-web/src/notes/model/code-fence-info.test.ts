import { describe, expect, it } from 'vitest';

import { formatCodeFenceInfo, parseCodeFenceInfo } from './code-fence-info';

/** Shares its table with `CodeFenceInfoTests.cs`. */
const VECTORS: readonly { language: string; caption: string; info: string }[] = [
  { language: 'ts', caption: '', info: 'ts' },
  { language: '', caption: '', info: '' },
  { language: 'ts', caption: 'Figure one', info: 'ts caption="Figure one"' },
  { language: '', caption: 'No language', info: 'caption="No language"' },
  { language: 'python', caption: 'say "hi"', info: 'python caption="say \\"hi\\""' },
  { language: 'sh', caption: 'C:\\temp\\x', info: 'sh caption="C:\\\\temp\\\\x"' },
  { language: 'js', caption: 'use `x`', info: 'js caption="use \\u0060x\\u0060"' },
  { language: 'js', caption: '\\u0060', info: 'js caption="\\\\u0060"' },
  { language: 'cs', caption: 'ends with a backslash \\', info: 'cs caption="ends with a backslash \\\\"' },
];

describe('code fence info', () => {
  it.each(VECTORS)('writes $info', ({ language, caption, info }) => {
    expect(formatCodeFenceInfo(language, caption)).toBe(info);
  });

  it.each(VECTORS)('reads $info', ({ language, caption, info }) => {
    expect(parseCodeFenceInfo(info)).toEqual({ head: language, caption });
  });

  it('writes a line break as a space and drops a blank caption', () => {
    expect(formatCodeFenceInfo('ts', 'one\r\ntwo')).toBe('ts caption="one two"');
    expect(formatCodeFenceInfo('ts', '  \n ')).toBe('ts');
  });

  it('leaves an info string without a closing caption exactly as it was', () => {
    for (const info of ['ts linenos', 'ts caption=plain', 'ts caption="open', 'ts caption="a" more', 'xcaption="a"']) {
      expect(parseCodeFenceInfo(info)).toEqual({ head: info, caption: '' });
    }
  });

  it('keeps extra words before the caption with the language', () => {
    expect(parseCodeFenceInfo('ts linenos caption="x"')).toEqual({ head: 'ts linenos', caption: 'x' });
  });
});
