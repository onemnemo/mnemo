import { useT } from '@/i18n/useT';
import { useSettingValue } from '@/settings/store';

/**
 * The editor content measure, in px, from the global Editor.Width setting.
 *
 * The setting stores the *translated* option label rather than a stable key (the
 * desktop's scheme), so the saved value is matched against the current language's
 * labels. Wide is the default and the reference measure; the column is centred
 * inside a fixed gutter, so the pane's max width is the measure plus that gutter
 * on both sides.
 */

/** Horizontal gutter each side, matching the `px-14` on the column. */
const GUTTER = 56;

/** The setting key, and its options widest-last, as the settings slider orders them. */
export const EDITOR_WIDTH_KEY = 'Editor.Width';

const WIDTHS = [
  { labelKey: 'SuperCompact', measure: 560 },
  { labelKey: 'Compact', measure: 640 },
  { labelKey: 'Wide', measure: 720 },
  { labelKey: 'SuperWide', measure: 960 },
] as const;

export interface EditorWidthOption {
  /** The stored value, which is the translated label itself. */
  readonly value: string;
  readonly measure: number;
}

/** The width choices in the current language, for a picker to offer. */
export function useEditorWidthOptions(): EditorWidthOption[] {
  const t = useT();
  return WIDTHS.map((w) => ({ value: t('Settings', w.labelKey), measure: w.measure }));
}

export function useEditorMeasure(): { measure: number; maxWidth: number; value: string } {
  const t = useT();
  const options = useEditorWidthOptions();
  const fallback = t('Settings', 'Wide');
  const value = useSettingValue(EDITOR_WIDTH_KEY, fallback);

  const measure = (options.find((option) => option.value === value) ?? options[2]).measure;

  return { measure, maxWidth: measure + GUTTER * 2, value };
}
