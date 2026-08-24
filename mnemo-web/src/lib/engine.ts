// The browser engine the app runs under, resolved once and handed to CSS.
//
// Its only consumer today is the notes editor's content-visibility gate (see
// notes/page/notes-editor.css). Skipping the layout of off-screen blocks is a
// real speed-up on Chromium, but WebKit can leave a revealed block with stale
// layout so its text stays in the DOM unpainted; the optimisation is therefore
// opted into per engine rather than shipped to all of them.
//
// The host is the authority. Mnemo.Host/Web/SpaHosting.cs templates
// window.__MNEMO_ENGINE__ into the page from the OS it launched on. Windows runs
// on WebView2 (Chromium); Linux and macOS run on WebKit. The process that created
// the window is the only thing that knows for certain which control it asked
// Photino for. Outside the packaged window (the Vite dev server in a browser tab,
// the test runner) that global is absent and the user agent stands in, which is
// fine for a dev build and is never what a shipped one relies on.

export type RenderEngine = 'chromium' | 'webkit'

/** The engine string the host injected, or undefined outside the packaged window. */
function declaredEngine(): string | undefined {
  return (window as { __MNEMO_ENGINE__?: string }).__MNEMO_ENGINE__
}

export function resolveRenderEngine(): RenderEngine {
  const declared = declaredEngine()
  if (declared === 'chromium' || declared === 'webkit') return declared

  // Dev/test fallback only. Every Chromium user agent carries a `Chrome/` token;
  // WebKitGTK and Safari carry `AppleWebKit` without one. Guessing wrong here only
  // costs the optimisation (webkit is the slower-but-correct path), never
  // correctness, so anything not positively identified as Chromium is webkit.
  return /\bChrome\//.test(navigator.userAgent) ? 'chromium' : 'webkit'
}

/**
 * Stamp the resolved engine on the document element as `data-engine`, so the
 * stylesheet can gate on it. Called once from the entry before React mounts, so
 * the attribute is present on first paint and no block flashes through the
 * skipped state.
 */
export function applyRenderEngine(): RenderEngine {
  const engine = resolveRenderEngine()
  document.documentElement.dataset.engine = engine
  return engine
}
