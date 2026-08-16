import { useSettingValue } from '@/settings/store';

/**
 * The document's spellcheck settings, as the attributes to put on the editor
 * container.
 *
 * Both are inherited by the contenteditable inside, so they can change without
 * tearing the view down. `lang` does not choose the dictionary, though: Chromium
 * ignores it for spell checking and consults whatever dictionaries the browser
 * profile has enabled. The app window's profile is set from this same setting at
 * startup (see WebViewSpellcheck in the host); `lang` is here for everything else
 * that reads it, hyphenation, font fallback and screen readers among them.
 */
export function useSpellcheck(): { spellCheck: boolean; lang: string } {
  const enabled = useSettingValue('Editor.SpellCheck', true);
  const lang = useSettingValue('Editor.SpellCheckLanguages', 'en');
  return { spellCheck: enabled, lang };
}
