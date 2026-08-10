import { useSettingValue } from '@/settings/store';

/**
 * The document's spellcheck settings, as the attributes to put on the editor
 * container.
 *
 * Both are inherited by the contenteditable inside, so they can change without
 * tearing the view down. The language matters as much as the switch: with no
 * `lang` the engine falls back to the app or system locale, which is how a note
 * written in English ends up underlined word for word on a machine set to
 * something else.
 */
export function useSpellcheck(): { spellCheck: boolean; lang: string } {
  const enabled = useSettingValue('Editor.SpellCheck', true);
  const lang = useSettingValue('Editor.SpellCheckLanguages', 'en');
  return { spellCheck: enabled, lang };
}
