// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { resolveRenderEngine } from './engine'

// resolveRenderEngine reads two ambient globals: the host-injected
// window.__MNEMO_ENGINE__ and, only when that is absent or unrecognised,
// navigator.userAgent. These helpers set each without leaking into the next case.
type WinWithEngine = { __MNEMO_ENGINE__?: string }

function setDeclared(value: string | undefined) {
  if (value === undefined) delete (window as WinWithEngine).__MNEMO_ENGINE__
  else (window as WinWithEngine).__MNEMO_ENGINE__ = value
}

function setUserAgent(value: string) {
  Object.defineProperty(navigator, 'userAgent', { value, configurable: true })
}

// Real user-agent shapes. WebView2 carries a `Chrome/` token; WebKitGTK, like
// Safari, carries `AppleWebKit` without one.
const WEBVIEW2_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
const WEBKITGTK_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'

afterEach(() => setDeclared(undefined))

describe('resolveRenderEngine', () => {
  it('trusts the host-injected engine over the user agent', () => {
    setUserAgent(WEBVIEW2_UA) // would resolve to chromium on its own
    setDeclared('webkit')
    expect(resolveRenderEngine()).toBe('webkit')
  })

  it('ignores an unrecognised injected value and falls back to the user agent', () => {
    setUserAgent(WEBKITGTK_UA)
    setDeclared('gecko')
    expect(resolveRenderEngine()).toBe('webkit')
  })

  it('reads Chromium from a WebView2 user agent when the host said nothing', () => {
    setUserAgent(WEBVIEW2_UA)
    expect(resolveRenderEngine()).toBe('chromium')
  })

  it('reads WebKit from a WebKitGTK user agent', () => {
    setUserAgent(WEBKITGTK_UA)
    expect(resolveRenderEngine()).toBe('webkit')
  })

  it('defaults to webkit (the correct-but-slower path) for an unknown agent', () => {
    setUserAgent('Some/1.0')
    expect(resolveRenderEngine()).toBe('webkit')
  })
})
