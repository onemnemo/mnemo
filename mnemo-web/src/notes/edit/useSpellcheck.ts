/**
 * The document's spellcheck settings, as the attributes to put on the editor
 * container.
 *
 * Both are inherited by the contenteditable inside, so they can change without
 * tearing the view down. `lang` does not choose the dictionary, though: Chromium
 * ignores it for spell checking and consults whatever dictionaries the browser
 * profile has enabled. The app window's profile is set at startup from the
 * first proofing language, or from the app language when no dictionary is
 * installed (see WebViewSpellcheck in the host); `lang` is here for everything
 * else that reads it, hyphenation, font fallback and screen readers among them.
 *
 * The browser checker stays off. Mnemo suppresses the webview context menu, so
 * a browser underline would have no suggestion or correction action behind it.
 * Mnemo's proofing decorations remain the only actionable spelling marks.
 */
export function useSpellcheck(language?: string): { spellCheck: boolean; lang: string } {
  return { spellCheck: false, lang: language ?? 'en' };
}
