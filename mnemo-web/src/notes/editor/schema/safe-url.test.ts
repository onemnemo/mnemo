// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { isSafeUrl } from './safe-url';

describe('isSafeUrl', () => {
  it('allows the safe schemes', () => {
    for (const url of ['http://a.test', 'https://a.test/x?y=1', 'mailto:a@b.test', 'tel:+15551234']) {
      expect(isSafeUrl(url)).toBe(true);
    }
  });

  it('allows relative links and fragments', () => {
    for (const url of ['/page', '#section', 'page.html', '?q=1', './x']) {
      expect(isSafeUrl(url)).toBe(true);
    }
  });

  it('rejects code-bearing schemes', () => {
    for (const url of ['javascript:alert(1)', 'JavaScript:alert(1)', 'vbscript:msgbox', 'data:text/html,x', 'file:///etc']) {
      expect(isSafeUrl(url)).toBe(false);
    }
  });

  it('rejects javascript: obfuscated with control characters the URL parser strips', () => {
    expect(isSafeUrl('java' + '\t' + 'script:alert(1)')).toBe(false);
    expect(isSafeUrl('java' + '\n' + 'script:alert(1)')).toBe(false);
    expect(isSafeUrl('java' + '\r' + 'script:alert(1)')).toBe(false);
    expect(isSafeUrl(String.fromCharCode(1) + 'javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('  javascript:alert(1)')).toBe(false);
  });

  it('rejects an empty or whitespace-only URL', () => {
    expect(isSafeUrl('')).toBe(false);
    expect(isSafeUrl('   ')).toBe(false);
  });
});
