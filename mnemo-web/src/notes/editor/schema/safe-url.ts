/**
 * Whether a URL is safe to render as a live link.
 *
 * The one scheme that must never survive is `javascript:` (and its cousins
 * `vbscript:`, `data:`, `file:`): a link carrying one is a click away from
 * running code, and the read-only note viewer renders links as ordinary
 * clickable anchors. So this is the single gate every path that ends at a link
 * href goes through, the clipboard sanitiser, the link mark's parse and render,
 * and the paste mark scrub, rather than trusting any one of them alone.
 *
 * The check strips control characters and spaces before reading the scheme
 * because the browser's URL parser does the same: it removes tab, newline and
 * carriage return from anywhere in the URL and trims leading control/space
 * before resolving the scheme, so `java&#9;script:` becomes `javascript:` when
 * clicked. A naive scheme regex would see the tab, miss the scheme, and wave it
 * through as if it were relative. Stripping first closes that bypass; it is only
 * used to judge safety, the original value is what gets kept when it is safe.
 */

/** Schemes a link may use. Everything else is treated as unsafe. */
const SAFE_SCHEMES: ReadonlySet<string> = new Set(['http', 'https', 'mailto', 'tel']);

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/** Drop every C0 control (code <= 0x1F) and the space (0x20) the URL parser ignores. */
function stripUrlNoise(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 0x20) out += value[i];
  }
  return out;
}

export function isSafeUrl(value: string): boolean {
  const stripped = stripUrlNoise(value);
  if (stripped === '') return false;
  const scheme = SCHEME.exec(stripped);
  // No scheme means a relative link or a fragment, which cannot run code.
  return scheme === null || SAFE_SCHEMES.has(scheme[1].toLowerCase());
}
