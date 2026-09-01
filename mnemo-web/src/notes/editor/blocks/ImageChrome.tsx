import { useState } from 'react';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

import { AppIcon } from '@/components/icon/AppIcon';
import {
  Menu,
  MenuCheckItem,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuSubMenu,
  MenuTrigger,
} from '@/components/ui/menu';
import { useT } from '@/i18n/useT';
import { cn } from '@/lib/utils';

import { locateBlock } from '../chrome/block-commands';
import {
  runBlockAction,
  runBlockVerb,
  type BlockMenuChoice,
} from '../chrome/block-menu-items';
import { imageMenuItems } from '../chrome/image-menu-items';
import type { BlockRegistry } from '../registry/build';
import type { EditorServices } from '../registry/types';
import { imageAlignOf } from './image-attrs';
import { captionRevealFor } from './image-caption-reveal';

/**
 * The controls on a picture: where it sits, and everything else behind a kebab.
 *
 * The rule is the note pane's own, a reading surface first. Nothing is on the picture until the
 * pointer is, and what appears is the one decision made constantly, where the figure sits, with
 * the rest a click away. Alignment is on the picture rather than only in the menu because it is
 * decided while looking at it, and a decision three levels into a menu is one people stop making.
 *
 * Mounted into the frame through the NodeView portal bridge, the way the code block's toolbar and
 * the table's handles are: the menu is an anchored, collision-aware surface, and hand-rolling that
 * flip is how a menu ends up half off the screen.
 */

const PILL_BUTTON =
  'grid size-7 place-items-center rounded-md text-ink-3 transition-colors duration-[var(--duration-fast)] hover:bg-frame-hover hover:text-ink aria-expanded:bg-frame-hover aria-expanded:text-ink';

const ALIGN_BUTTONS = [
  { id: 'left', key: 'ImageAlignLeftTooltip', icon: 'align-left' },
  { id: 'center', key: 'ImageAlignCenterTooltip', icon: 'align-center' },
  { id: 'right', key: 'ImageAlignRightTooltip', icon: 'align-right' },
] as const;

export interface ImageChromeProps {
  view: EditorView;
  registry: BlockRegistry;
  services: EditorServices;
  /** The image block as the view last saw it. */
  node: PMNode;
  /** Its live position, or undefined once ProseMirror has lost the node. */
  getPos: () => number | undefined;
  onAlign: (align: string) => void;
}

export function ImageChrome({ view, registry, services, node, getPos, onAlign }: ImageChromeProps) {
  const t = useT();
  const [open, setOpen] = useState(false);

  const align = imageAlignOf(node);
  const sid = String(node.attrs.sid ?? '');
  const pos = getPos();

  // Built only while the menu is up: the size rows measure the column, and a layout read on every
  // render of every picture in the note is not something a hover should cost.
  const location = open && pos !== undefined ? locateBlock(view.state, registry, pos, sid) : null;
  const entries =
    open && location
      ? imageMenuItems({
          view,
          registry,
          node: location.node,
          location,
          services,
          t,
          caption: captionRevealFor(view, sid),
        })
      : [];

  const target = location ? { pos: location.pos, sid } : null;

  // A picture the document cannot resolve has nothing to offer, so the kebab never opens on an
  // empty panel. Resolved here, on the click, rather than joining the per-render checks above:
  // this runs once per open attempt, not once per hover of every picture in the note.
  const handleMenuOpenChange = (next: boolean) => {
    if (!next) {
      setOpen(false);
      return;
    }
    const resolved = pos !== undefined ? locateBlock(view.state, registry, pos, sid) : null;
    if (!resolved) return;
    setOpen(true);
  };

  const renderChoice = (entry: BlockMenuChoice) => {
    if (entry.kind === 'verb') {
      return (
        <MenuItem
          key={entry.id}
          icon={entry.icon}
          danger={entry.danger}
          disabled={entry.disabled}
          onSelect={() => {
            if (target) runBlockVerb(view, registry, target, entry);
          }}
        >
          {entry.label}
        </MenuItem>
      );
    }
    const run = () => {
      if (target) runBlockAction(view, registry, target, entry);
    };
    if (entry.checked === undefined) {
      return (
        <MenuItem key={entry.id} icon={entry.icon} danger={entry.danger} disabled={entry.disabled} onSelect={run}>
          {entry.label}
        </MenuItem>
      );
    }
    return (
      <MenuCheckItem key={entry.id} checked={entry.checked} icon={entry.icon} disabled={entry.disabled} onSelect={run}>
        {entry.label}
      </MenuCheckItem>
    );
  };

  return (
    <div
      contentEditable={false}
      suppressContentEditableWarning
      className={cn(
        'flex items-center gap-0.5 rounded-lg p-0.5',
        // Canvas at 85 percent rather than a dark scrim: the pill has to read on a white scan and
        // on a black micrograph alike.
        'bg-canvas/85 shadow-pop backdrop-blur-sm',
      )}
      // A press on chrome is not a place to type: this keeps the caret where it was and stops
      // ProseMirror reading the press as a click into the block's own DOM.
      onMouseDown={(event) => {
        event.preventDefault();
      }}
    >
      {ALIGN_BUTTONS.map((button) => (
        <button
          key={button.id}
          type="button"
          // Not a tab stop, like the gutter's own buttons: the pointer already reaches these, and
          // a stray Tab landing in invisible chrome is a detour a reader cannot see they are in.
          tabIndex={-1}
          aria-label={t('NotesEditor', button.key)}
          title={t('NotesEditor', button.key)}
          aria-pressed={align === button.id}
          className={cn(PILL_BUTTON, align === button.id && 'bg-frame-hover text-ink')}
          onClick={() => {
            onAlign(button.id);
          }}
        >
          <AppIcon name={button.icon} size={14} />
        </button>
      ))}

      <span aria-hidden className="mx-0.5 h-4 w-px bg-line-soft" />

      <Menu open={open} onOpenChange={handleMenuOpenChange}>
        <MenuTrigger asChild>
          <button type="button" tabIndex={-1} aria-label={t('NotesEditor', 'ImageOptions')} className={PILL_BUTTON}>
            <AppIcon name="ellipsis" size={15} />
          </button>
        </MenuTrigger>
        <MenuContent align="end">
          {entries.map((entry) => {
            switch (entry.kind) {
              case 'separator':
                return <MenuSeparator key={entry.id} />;
              case 'submenu':
                return (
                  <MenuSubMenu key={entry.id} label={entry.label} icon={entry.icon}>
                    {entry.items.map(renderChoice)}
                  </MenuSubMenu>
                );
              case 'verb':
              case 'action':
                return renderChoice(entry);
            }
            // A new entry kind with no case above would render as undefined, which React rejects
            // with an error naming this component rather than the row.
            const unhandled: never = entry;
            throw new Error(`[notes] no renderer for image menu entry ${JSON.stringify(unhandled)}`);
          })}
        </MenuContent>
      </Menu>
    </div>
  );
}
