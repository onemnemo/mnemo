import {
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
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

import { markForRightClick } from '../../proofing/card-triggers';
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
import { canPasteFromMenu, hasClipboardSelection, runClipboardVerb, runPasteVerb } from './selection-clipboard';

/**
 * The note editor's right-click menu.
 *
 * The webview's own menu is suppressed app-wide, so this is the only answer a
 * right click in a note has. It offers what the press landed on: the clipboard
 * verbs over prose, the block verbs on a block selection, the picture's own rows
 * on a picture. On a plain caret cut and copy are drawn greyed rather than left
 * out, so the menu keeps one shape over prose and a reader who meant to select
 * first can see what the verbs are waiting for.
 *
 * A marked word is the one press this declines. A right click on a proofing mark
 * with nothing selected opens the card, the same card a left click opens, and
 * this stays shut so the press has one answer rather than two. A selection tips
 * it back: the reader has a range in hand and the verbs for it are what the
 * press is asking about.
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
 * The offer is decided on pointerdown, not on the contextmenu event: Chromium
 * moves the caret (and selects the misspelled word) on the mousedown that
 * precedes the menu, so by contextmenu time the selection is no longer the one
 * the reader was looking at. A menu opened from the keyboard has no press behind
 * it and reads the live selection instead, because carrying the last press's
 * offer over would run its verbs against a block the reader has since left.
 */

interface MenuSnapshot {
  /** Cut and copy, drawn when the press was over prose; `live` is whether they have a range. */
  readonly text: { readonly live: boolean } | null;
  readonly paste: boolean;
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
  const isImage = located.node.type.name === 'image';
  const blocks = isImage
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
  // A paste over selected blocks takes their place, which is the one clipboard
  // verb a block selection can carry: cut and copy need a DOM range, and the
  // selection leaves the caret collapsed. A picture's rows are about that
  // picture, and its press selects nothing, so a paste there would land at
  // whatever caret was left elsewhere in the note.
  return { text: null, paste: !isImage && canPasteFromMenu(), blocks, target: { pos: located.pos, sid } };
}

/**
 * What the menu offers, or null when it should not open at all.
 *
 * `coords` is where the pointer was, and null when the keyboard asked and there
 * is no pointer to read.
 */
function snapshotAt(
  view: EditorView,
  registry: BlockRegistry,
  services: EditorServices,
  t: TranslateFn,
  coords: { left: number; top: number } | null,
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
      (coords ? view.posAtCoords(coords)?.pos : undefined) ?? state.selection.head,
    );
    if (!located) return null;
    return blockSnapshot(view, registry, services, t, located);
  }

  const paste = canPasteFromMenu();
  if (hasClipboardSelection(state)) return { text: { live: true }, paste, blocks: [], target: null };
  // A caret has nothing to cut or copy, so paste is the whole menu; where it
  // cannot be offered there is no menu to draw and the press does nothing.
  return paste ? { text: { live: false }, paste, blocks: [], target: null } : null;
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
  // Whether the snapshot beside it was taken by a press. False means the menu was
  // asked for from the keyboard, which has no press and no coordinate behind it.
  const pressed = useRef(false);

  const snapshotFor = (coords: { left: number; top: number } | null, press: ImagePress | null) =>
    view ? snapshotAt(view, registry, resolveServices(services), t, coords, press) : null;

  const onPointerDown = (event: ReactPointerEvent) => {
    // Taken on every press, not only the one that opens a menu: a picture records its press
    // whatever the button, and a left click's would otherwise still be sitting there to answer
    // for a right click on some other block.
    const press = takeImagePress();
    pressed.current = event.button === 2;
    if (!pressed.current) return;
    // A marked word answers this press with its card, so the menu declines it.
    const marked = view !== null && markForRightClick(view, event.target) !== null;
    setSnapshot(marked ? null : snapshotFor({ left: event.clientX, top: event.clientY }, press));
  };

  const onContextMenu = (event: ReactMouseEvent) => {
    const fromPress = pressed.current;
    pressed.current = false;
    const offer = fromPress ? snapshot : snapshotFor(null, null);
    if (!fromPress) setSnapshot(offer);
    // Radix opens on this event unless it has already been answered, which is how
    // a press with nothing to offer, and one the proofing card took, stay shut.
    if (offer === null) event.preventDefault();
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
        <ContextMenuTrigger asChild onPointerDown={onPointerDown} onContextMenu={onContextMenu}>
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent>
          {snapshot?.text && view ? (
            <>
              <ContextMenuItem
                icon="scissors"
                disabled={!snapshot.text.live}
                onSelect={() => runClipboardVerb(view, 'cut')}
              >
                {t('Common', 'Cut')}
              </ContextMenuItem>
              <ContextMenuItem
                icon="copy"
                disabled={!snapshot.text.live}
                onSelect={() => runClipboardVerb(view, 'copy')}
              >
                {t('Common', 'Copy')}
              </ContextMenuItem>
            </>
          ) : null}
          {snapshot?.paste && view ? (
            <ContextMenuItem icon="clipboard-paste" onSelect={() => void runPasteVerb(view)}>
              {t('Common', 'Paste')}
            </ContextMenuItem>
          ) : null}
          {snapshot?.paste && snapshot.blocks.length > 0 ? <ContextMenuSeparator /> : null}
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
