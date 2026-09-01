import { useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import {
  ContextMenu,
  ContextMenuCheckItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSubMenu,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import type { TranslateFn } from '@/i18n/types';
import { useT } from '@/i18n/useT';

import { getBlockSelection } from '../../selection/block-selection-plugin';
import { captionRevealFor } from '../blocks/image-caption-reveal';
import { deepestBlockAt } from '../pipeline/block-locate';
import type { BlockRegistry } from '../registry/build';
import type { EditorServices } from '../registry/types';
import { resolveServices } from '../view/nodeviews';
import { locateBlock } from './block-commands';
import {
  blockMenuItems,
  runBlockAction,
  runBlockRequest,
  runBlockVerb,
  type BlockMenuAction,
  type BlockMenuChoice,
  type BlockMenuEntry,
  type BlockMenuRequest,
  type BlockMenuVerb,
} from './block-menu-items';
import { imageMenuItems } from './image-menu-items';
import { takeImagePress, type ImagePress } from './image-press';
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
 * A picture is the one block that answers about itself. Right-clicking one offers the same rows
 * its own pill does, in place of the generic block menu, because "crop this" and "align this" are
 * what a right-click on a figure is asking and the generic list cannot say either.
 *
 * A picture's press is the one offer that stands without a selection behind it. Its media is the
 * node view's own opaque DOM, so `posAtCoords` resolves nothing over it, and a right-click on a
 * picture deliberately selects nothing, so neither the coordinate nor the selection can name what
 * was pressed. The press itself can, and it is asked first.
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

/**
 * The block a press on a picture named, re-located against the live document.
 *
 * `locateBlock` is the verification as well as the lookup: a slot whose sid no longer sits where
 * it said resolves elsewhere by sid or not at all, and a block that is gone answers null, so a
 * press left over from a document that has since changed cannot name whatever now occupies its
 * old position.
 */
function pressedBlock(
  state: EditorState,
  registry: BlockRegistry,
  press: ImagePress | null,
): { pos: number; node: PMNode } | null {
  if (!press) return null;
  const located = locateBlock(state, registry, press.pos, press.sid);
  return located ? { pos: located.pos, node: located.node } : null;
}

/** The rows one block offers, and the target the menu runs them against. */
function blockSnapshot(
  view: EditorView,
  registry: BlockRegistry,
  services: EditorServices,
  t: TranslateFn,
  located: { pos: number; node: PMNode },
): MenuSnapshot {
  const state = view.state;
  const sid = String(located.node.attrs.sid ?? '');
  const location = locateBlock(state, registry, located.pos, sid);
  const blocks =
    located.node.type.name === 'image'
      ? imageMenuItems({
          view,
          registry,
          node: located.node,
          location,
          services,
          t,
          caption: captionRevealFor(view, sid),
        })
      : blockMenuItems({ state, registry, node: located.node, location, t });
  return { clipboard: false, blocks, target: { pos: located.pos, sid } };
}

function snapshotAt(
  view: EditorView,
  registry: BlockRegistry,
  services: EditorServices,
  t: TranslateFn,
  coords: { left: number; top: number },
  press: ImagePress | null,
): MenuSnapshot | null {
  const state = view.state;

  // A press on a picture is the whole answer, selection or none: it names its own block, which
  // is the only thing that can, and offering the picture's rows is the point of the press.
  const pressed = pressedBlock(state, registry, press);
  if (pressed) return blockSnapshot(view, registry, services, t, pressed);

  if (getBlockSelection(state).selected.size > 0) {
    // The block under the pointer is the one the verbs name, and a click that lands between
    // blocks or in the page margin falls back to the caret's block.
    const located = deepestBlockAt(
      state.doc,
      registry,
      view.posAtCoords(coords)?.pos ?? state.selection.head,
    );
    if (!located) return null;
    return blockSnapshot(view, registry, services, t, located);
  }

  if (hasClipboardSelection(state)) return { clipboard: true, blocks: [], target: null };
  return null;
}

export function EditorContextMenu({
  view,
  registry,
  services,
  children,
}: {
  view: EditorView | null;
  registry: BlockRegistry;
  /** The same handles the node views get; the image rows upload, fetch and bake through them. */
  services?: Partial<EditorServices>;
  children: ReactNode;
}) {
  const t = useT();
  const { message, announce } = useAnnouncer();
  const [snapshot, setSnapshot] = useState<MenuSnapshot | null>(null);

  const onPointerDown = (event: ReactPointerEvent) => {
    // Taken on every press, not only the one that opens a menu: a picture records its press
    // whatever the button, and a left click's would otherwise still be sitting there to answer
    // for a right click on some other block.
    const press = takeImagePress();
    if (event.button !== 2) return;
    setSnapshot(
      view
        ? snapshotAt(
            view,
            registry,
            resolveServices(services),
            t,
            { left: event.clientX, top: event.clientY },
            press,
          )
        : null,
    );
  };

  const run = (verb: BlockMenuVerb) => {
    if (!view || !snapshot?.target) return;
    if (!runBlockVerb(view, registry, snapshot.target, verb)) return;
    if (verb.announce !== null) announce(verb.announce);
  };

  const act = (action: BlockMenuAction) => {
    if (!view || !snapshot?.target) return;
    runBlockAction(view, registry, snapshot.target, action);
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

  const renderAction = (action: BlockMenuAction) =>
    action.checked === undefined ? (
      <ContextMenuItem
        key={action.id}
        icon={action.icon}
        danger={action.danger}
        disabled={action.disabled}
        onSelect={() => act(action)}
      >
        {action.label}
      </ContextMenuItem>
    ) : (
      <ContextMenuCheckItem
        key={action.id}
        checked={action.checked}
        icon={action.icon}
        disabled={action.disabled}
        onSelect={() => act(action)}
      >
        {action.label}
      </ContextMenuCheckItem>
    );

  const renderChoice = (choice: BlockMenuChoice) =>
    choice.kind === 'verb' ? renderVerb(choice) : renderAction(choice);

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
                    {entry.items.map(renderChoice)}
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
              case 'action':
                return renderAction(entry);
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
