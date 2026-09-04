import { useSettingValue } from '@/settings/store';

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
 * `Proofing.Enabled` is the master switch, and it means what it says: with it
 * off nothing checks this prose, the browser's own checker included. A reader
 * who turns spell check off and still sees red underlines has been told the
 * switch does nothing.
 *
 * With it on, the browser's checker is a fallback for the case Mnemo's cannot
 * cover. `standDown` takes it off the prose whenever Mnemo's is marking, since
 * two checkers underline the same word twice from two dictionaries that
 * disagree, or whenever the note is meant to go unchecked. What is left is a
 * note nothing of ours can read, a dictionary still loading or none installed,
 * and there the browser is better than nothing. `Editor.SpellCheck` is the way
 * to turn that fallback off as well; it means different things per platform,
 * because the window's profile dictionary is written on Windows only.
 */
export function useSpellcheck(standDown = false, language?: string): { spellCheck: boolean; lang: string } {
  const enabled = useSettingValue('Proofing.Enabled', true);
  const fallback = useSettingValue('Editor.SpellCheck', true);
  return { spellCheck: enabled && fallback && !standDown, lang: language ?? 'en' };
}
