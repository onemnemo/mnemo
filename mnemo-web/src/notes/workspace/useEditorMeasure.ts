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

const MEASURE = { superCompact: 560, compact: 640, wide: 720, superWide: 960 } as const;

export function useEditorMeasure(): { measure: number; maxWidth: number } {
  const t = useT();
  const st = (key: string) => t('Settings', key);
  const value = useSettingValue('Editor.Width', st('Wide'));

  const measure =
    value === st('SuperCompact')
      ? MEASURE.superCompact
      : value === st('Compact')
        ? MEASURE.compact
        : value === st('SuperWide')
          ? MEASURE.superWide
          : MEASURE.wide;

  return { measure, maxWidth: measure + GUTTER * 2 };
}
