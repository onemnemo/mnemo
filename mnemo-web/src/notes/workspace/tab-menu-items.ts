import type { IconName } from '@/components/icon/icon-registry';
import type { TranslateFn } from '@/i18n/types';

/**
 * The tab strip's verbs, described once, with no React and no store behind them
 * so the whole list can be read in a test without a DOM.
 *
 * The list is rebuilt on every render rather than captured on the press that
 * raises the menu. Shift+F10 and the Menu key fire a `contextmenu` with no
 * pointer event before it, so anything remembered from a press would be last
 * time's tab or nothing at all.
 */

export interface TabMenuItem {
  readonly kind: 'item';
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  readonly disabled?: boolean;
  readonly run: () => void;
}

export interface TabMenuSeparator {
  readonly kind: 'separator';
  readonly id: string;
}

export type TabMenuEntry = TabMenuItem | TabMenuSeparator;

/**
 * Where the verbs go. The two optional ones open a surface this build may not
 * have: with no handler the item is left out rather than shown greyed out, since
 * a permanently dead row teaches the reader nothing. Disabled is for a verb that
 * does exist and simply cannot apply to this tab, such as closing the tabs to
 * the left of the first one.
 */
export interface TabMenuHandlers {
  readonly close: () => void;
  readonly closeOthers: () => void;
  readonly closeLeft: () => void;
  readonly closeRight: () => void;
  readonly openInPeek?: () => void;
  readonly moveToWindow?: () => void;
}

export function tabMenuItems({
  index,
  count,
  t,
  on,
}: {
  index: number;
  count: number;
  t: TranslateFn;
  on: TabMenuHandlers;
}): readonly TabMenuEntry[] {
  const nt = (key: string) => t('Notes', key);
  const entries: TabMenuEntry[] = [];

  if (on.openInPeek) {
    entries.push({
      kind: 'item',
      id: 'peek',
      label: nt('OpenInSidePeek'),
      icon: 'common/panel-right',
      run: on.openInPeek,
    });
  }
  if (on.moveToWindow) {
    entries.push({
      kind: 'item',
      id: 'window',
      label: nt('MoveToNewWindow'),
      icon: 'external-link',
      run: on.moveToWindow,
    });
  }
  // Only once there is something above it to divide from.
  if (entries.length > 0) entries.push({ kind: 'separator', id: 'sep.close' });

  entries.push(
    { kind: 'item', id: 'close', label: nt('CloseTab'), icon: 'common/x', run: on.close },
    {
      kind: 'item',
      id: 'close-others',
      label: nt('CloseOtherTabs'),
      icon: 'common/square-rounded-x',
      disabled: count < 2,
      run: on.closeOthers,
    },
    {
      kind: 'item',
      id: 'close-left',
      label: nt('CloseTabsToTheLeft'),
      icon: 'common/chevron-left',
      disabled: index === 0,
      run: on.closeLeft,
    },
    {
      kind: 'item',
      id: 'close-right',
      label: nt('CloseTabsToTheRight'),
      icon: 'common/chevron-right',
      disabled: index === count - 1,
      run: on.closeRight,
    },
  );

  return entries;
}
