import { useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { EditorView } from 'prosemirror-view';

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSubMenu,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import type { TranslateFn } from '@/i18n/types';
import { useT } from '@/i18n/useT';

import { getBlockSelection } from '../../selection/block-selection-plugin';
import { deepestBlockAt } from '../pipeline/block-locate';
import type { BlockRegistry } from '../registry/build';
import { locateBlock } from './block-commands';
import {
  blockMenuItems,
  runBlockRequest,
  runBlockVerb,
  type BlockMenuEntry,
  type BlockMenuRequest,
  type BlockMenuVerb,
} from './block-menu-items';
import { Announcer } from './Announcer';
import { useAnnouncer } from './useAnnouncer';
import { hasClipboardSelection, runClipboardVerb } from './selection-clipboard';

/**
 * The note editor's right-click menu.
 *
 * It offers what was selected before the click: the clipboard verbs on a text
 * range, the block verbs on a block selection. On a plain caret it offers
 * nothing and stays out of the way, which is deliberate. The webview's own menu
 * is the only place its spelling suggestions live, and a caret right-click on a
 * misspelled word is exactly how a reader asks for them.
 *
 * The offer is decided on pointerdown, not on the contextmenu event, for two
 * reasons. Chromium moves the caret (and selects the misspelled word) on the
 * mousedown that precedes the menu, so by contextmenu time the selection is no
 * longer the one the reader was looking at. And radix's trigger only yields to
 * the native menu through `disabled`, which it reads at render: preventing its
 * handler from the contextmenu event would take the native menu down with it.
 */

interface MenuSnapshot {
  readonly clipboard: boolean;
  readonly blocks: readonly BlockMenuEntry[];
  readonly target: { pos: number; sid: string } | null;
}

function snapshotAt(
  view: EditorView,
  registry: BlockRegistry,
  t: TranslateFn,
  coords: { left: number; top: number },
): MenuSnapshot | null {
  const state = view.state;

  if (getBlockSelection(state).selected.size > 0) {
    // The block under the pointer is the one the verbs name; a click that lands
    // between blocks or in the page margin falls back to the caret's block.
    const at = view.posAtCoords(coords)?.pos ?? state.selection.head;
    const located = deepestBlockAt(state.doc, registry, at);
    if (!located) return null;
    const sid = String(located.node.attrs.sid ?? '');
    return {
      clipboard: false,
      blocks: blockMenuItems({
        state,
        registry,
        node: located.node,
        location: locateBlock(state, registry, located.pos, sid),
        t,
      }),
      target: { pos: located.pos, sid },
    };
  }

  if (hasClipboardSelection(state)) return { clipboard: true, blocks: [], target: null };
  return null;
}

export function EditorContextMenu({
  view,
  registry,
  children,
}: {
  view: EditorView | null;
  registry: BlockRegistry;
  children: ReactNode;
}) {
  const t = useT();
  const { message, announce } = useAnnouncer();
  const [snapshot, setSnapshot] = useState<MenuSnapshot | null>(null);

  const onPointerDown = (event: ReactPointerEvent) => {
    if (event.button !== 2) return;
    setSnapshot(view ? snapshotAt(view, registry, t, { left: event.clientX, top: event.clientY }) : null);
  };

  const run = (verb: BlockMenuVerb) => {
    if (!view || !snapshot?.target) return;
    if (!runBlockVerb(view, registry, snapshot.target, verb)) return;
    if (verb.announce !== null) announce(verb.announce);
  };

  const raise = (entry: BlockMenuRequest) => {
    if (!snapshot?.target) return;
    runBlockRequest(snapshot.target, entry);
  };

  const renderVerb = (verb: BlockMenuVerb) => (
    <ContextMenuItem
      key={verb.id}
      icon={verb.icon}
      danger={verb.danger}
      disabled={verb.disabled}
      onSelect={() => run(verb)}
    >
      {verb.label}
    </ContextMenuItem>
  );

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild disabled={snapshot === null} onPointerDown={onPointerDown}>
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent>
          {snapshot?.clipboard && view ? (
            <>
              <ContextMenuItem icon="copy" onSelect={() => runClipboardVerb(view, 'copy')}>
                {t('Common', 'Copy')}
              </ContextMenuItem>
              <ContextMenuItem icon="scissors" onSelect={() => runClipboardVerb(view, 'cut')}>
                {t('Common', 'Cut')}
              </ContextMenuItem>
            </>
          ) : null}
          {snapshot?.blocks.map((entry) => {
            switch (entry.kind) {
              case 'separator':
                return <ContextMenuSeparator key={entry.id} />;
              case 'submenu':
                return (
                  <ContextMenuSubMenu key={entry.id} label={entry.label} icon={entry.icon}>
                    {entry.items.map(renderVerb)}
                  </ContextMenuSubMenu>
                );
              case 'request':
                return (
                  <ContextMenuItem key={entry.id} icon={entry.icon} onSelect={() => raise(entry)}>
                    {entry.label}
                  </ContextMenuItem>
                );
              case 'verb':
                return renderVerb(entry);
            }
            // A new entry kind with no case above would render as undefined, which
            // React rejects with an error naming this component rather than the
            // row. The annotation makes it a build failure instead.
            const unhandled: never = entry;
            throw new Error(`[notes] no renderer for block menu entry ${JSON.stringify(unhandled)}`);
          })}
        </ContextMenuContent>
      </ContextMenu>
      <Announcer message={message} />
    </>
  );
}
