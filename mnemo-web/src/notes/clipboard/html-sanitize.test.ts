// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { sanitizeExternalHtml } from './html-sanitize';

/** Sanitise and return the cleaned fragment, failing the test if it was rejected. */
function clean(html: string): DocumentFragment {
  const outcome = sanitizeExternalHtml(html);
  if ('tooLarge' in outcome) throw new Error('sanitize unexpectedly reported too large');
  return outcome.fragment;
}

describe('sanitizeExternalHtml scrubbing', () => {
  it('drops a script element and its source, keeping surrounding text', () => {
    const fragment = clean('<p>hi</p><script>alert(1)</script>');
    expect(fragment.querySelector('script')).toBeNull();
    expect(fragment.textContent).toBe('hi');
    expect(fragment.textContent).not.toContain('alert');
  });

  it('drops style, iframe and object wholesale', () => {
    const fragment = clean('<style>p{}</style><iframe src="x"></iframe><object></object><p>ok</p>');
    expect(fragment.querySelector('style')).toBeNull();
    expect(fragment.querySelector('iframe')).toBeNull();
    expect(fragment.querySelector('object')).toBeNull();
    expect(fragment.textContent).toBe('ok');
  });

  it('drops every image, remote and data-uri alike', () => {
    const fragment = clean('<p>x</p><img src="http://tracker/x.png"><img src="data:image/png;base64,AAAA">');
    expect(fragment.querySelectorAll('img')).toHaveLength(0);
    expect(fragment.textContent).toBe('x');
  });

  it('neutralises a javascript: href but keeps a safe one', () => {
    const fragment = clean('<a href="javascript:alert(1)">a</a><a href="https://ok.test">b</a>');
    const links = fragment.querySelectorAll('a');
    expect(links[0].hasAttribute('href')).toBe(false);
    expect(links[1].getAttribute('href')).toBe('https://ok.test');
  });

  it('keeps relative and anchor hrefs', () => {
    const fragment = clean('<a href="#section">a</a><a href="/page">b</a>');
    const links = fragment.querySelectorAll('a');
    expect(links[0].getAttribute('href')).toBe('#section');
    expect(links[1].getAttribute('href')).toBe('/page');
  });

  it('strips event-handler attributes', () => {
    const fragment = clean('<p onclick="x()" onmouseover="y()">t</p>');
    const p = fragment.querySelector('p')!;
    expect(p.hasAttribute('onclick')).toBe(false);
    expect(p.hasAttribute('onmouseover')).toBe(false);
  });

  it('keeps inline formatting elements and the style that drives marks', () => {
    const fragment = clean('<p><strong>b</strong><em>i</em><span style="font-weight:bold">c</span></p>');
    expect(fragment.querySelector('strong')).not.toBeNull();
    expect(fragment.querySelector('em')).not.toBeNull();
    expect(fragment.querySelector('span')!.getAttribute('style')).toContain('font-weight');
  });

  it('neutralises a javascript: href obfuscated with a tab', () => {
    // &#9; decodes to a literal tab inside the attribute; the browser would strip
    // it and resolve the scheme back to javascript:.
    const fragment = clean('<a href="java&#9;script:alert(1)">x</a>');
    expect(fragment.querySelector('a')!.hasAttribute('href')).toBe(false);
  });

  it('drops a foreign-namespace svg subtree whole, beacon href and all', () => {
    const fragment = clean('<p>x</p><svg><image href="http://tracker/x.png"/></svg>');
    expect(fragment.querySelector('svg')).toBeNull();
    expect(fragment.querySelector('image')).toBeNull();
    expect(fragment.textContent).toBe('x');
  });
});

describe('sanitizeExternalHtml caps', () => {
  it('rejects HTML past the length cap', () => {
    expect(sanitizeExternalHtml('a'.repeat(2_000_001))).toEqual({ tooLarge: true });
  });

  it('rejects nesting past the depth cap', () => {
    const deep = '<div>'.repeat(70) + '</div>'.repeat(70);
    expect(sanitizeExternalHtml(deep)).toEqual({ tooLarge: true });
  });

  it('rejects a paste with too many nodes', () => {
    expect(sanitizeExternalHtml('<p></p>'.repeat(20_001))).toEqual({ tooLarge: true });
  });

  it('rejects an attribute bomb on a single element', () => {
    // One element, but its attributes alone blow the node budget, so the O(n)
    // scrub and the parser's per-attribute work stay bounded.
    const attrs = Array.from({ length: 21_000 }, (_unused, i) => `a${i}`).join(' ');
    expect(sanitizeExternalHtml(`<div ${attrs}></div>`)).toEqual({ tooLarge: true });
  });

  it('accepts ordinary content well within the caps', () => {
    const outcome = sanitizeExternalHtml('<p>a</p><p>b</p>');
    expect('fragment' in outcome).toBe(true);
  });
});
