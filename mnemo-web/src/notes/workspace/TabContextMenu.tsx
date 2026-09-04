import type { ReactNode } from 'react';

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

import type { TabMenuEntry } from './tab-menu-items';

/**
 * Right-click a tab and get its verbs.
 *
 * The trigger is `asChild` so the tab itself raises the menu: anything Radix
 * rendered of its own would sit between the tablist and its tabs and break both
 * the row and the ARIA structure. Radix composes onto the handlers the tab
 * already carries, so the press that starts a drag and the press that opens
 * this both still arrive.
 */
export function TabContextMenu({
  entries,
  children,
}: {
  entries: readonly TabMenuEntry[];
  children: ReactNode;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {entries.map((entry) =>
          entry.kind === 'separator' ? (
            <ContextMenuSeparator key={entry.id} />
          ) : (
            <ContextMenuItem key={entry.id} icon={entry.icon} disabled={entry.disabled} onSelect={entry.run}>
              {entry.label}
            </ContextMenuItem>
          ),
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
