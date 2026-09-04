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
 *
 * `standDown` takes the browser's checker off this prose, and it covers two
 * cases. Mnemo's own checker is marking it, and two checkers underline the same
 * word twice from two dictionaries that disagree, only one of which answers to
 * the settings page. Or the note is meant to go unchecked, in which case a
 * second checker filling in is the one answer the reader did not ask for.
 *
 * It is off rather than absent, so the browser's checking comes straight back
 * the moment proofing is turned off or its dictionary is not ready. That
 * fallback means different things per platform: the window's profile
 * dictionary is written on Windows only, so macOS and Linux fall back to
 * whatever the system checker offers.
 */
export function useSpellcheck(standDown = false): { spellCheck: boolean; lang: string } {
  const enabled = useSettingValue('Editor.SpellCheck', true);
  const lang = useSettingValue('Editor.SpellCheckLanguages', 'en');
  return { spellCheck: enabled && !standDown, lang };
}
