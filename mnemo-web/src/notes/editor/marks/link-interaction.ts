/**
 * What a click on a link inside an editable note does.
 *
 * Two jobs, and the first is not optional. The shipped window is chromeless, so
 * a link that navigates replaces the whole application with a web page and
 * leaves no way back. The browser declines to follow a link inside a
 * `contenteditable` on a plain click, but a modifier press is not a plain click
 * and the host registers no navigation handler of its own, so the guard is
 * here: every anchor activation inside the editable root has its default taken
 * away, whatever put it there. The read-only viewer in the side panel has had
 * the same guard from the day it was written.
 *
 * The second job is the affordance that was missing behind it. Hovering or a
 * plain click raises the link card; a Ctrl or Cmd click is read as "just open
 * it" and goes straight to the operating system's browser. Both go through
 * {@link openExternally}, never `window.open`.
 *
 * Only anchors carrying the link mark are answered. Page rows and page
 * references are anchors too, and each routes its own click; asking the
 * document which mark is at the position keeps this from guessing from the DOM.
 */

import { Plugin, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { openExternally } from '@/lib/external';
import { isSafeUrl } from '../schema/safe-url';
import { anchorInContainer, scrollContainerOf } from '../floating/scroll-container';
import type { Rect } from '../floating/position';
import { linkPopoverFor } from '../toolbar/link-popover-registry';
import { canOpenExternally, createLinkChip } from './link-chip';
import { currentLinkHref, linkAt, linkContextAt } from './link-commands';

const HOVER_OPEN_DELAY_MS = 260;
const HOVER_CLOSE_DELAY_MS = 140;

function rectOf(element: HTMLElement): Rect {
  const box = element.getBoundingClientRect();
  return { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
}

/**
 * The link-mark anchor under an event target, with the href the document holds
 * for it.
 *
 * One inside the anchor's first character, because the link mark excludes its
 * own boundaries: the position in front of the run reports no mark at all, and
 * a page row or a page reference reports something that is not a link.
 */
function linkUnder(view: EditorView, target: EventTarget | null): { href: string; dom: HTMLElement } | null {
  if (!(target instanceof Element)) return null;
  const dom = target.closest('a[href]');
  if (!(dom instanceof HTMLElement) || !view.dom.contains(dom)) return null;
  try {
    const href = linkAt(view.state.doc, view.posAtDOM(dom, 0) + 1);
    return href === null ? null : { href, dom };
  } catch {
    return null;
  }
}

function openSafely(href: string): void {
  if (isSafeUrl(href) && canOpenExternally(href)) openExternally(href);
}

/** True for the press that means "follow this link now" rather than "put the caret here". */
function isDirectOpen(event: MouseEvent): boolean {
  return event.ctrlKey || event.metaKey;
}

export function linkInteractionPlugin(): Plugin {
  return new Plugin({
    view(view) {
      let openHref: string | null = null;
      let anchorDom: HTMLElement | null = null;
      /**
       * The caret has been inside this link at least once since the chip
       * opened, which is what lets a later move out of it close the chip.
       *
       * Armed at the open when the selection already agrees, and otherwise on
       * the first update that does. A click is answered before ProseMirror has
       * necessarily settled its own selection, and arming unconditionally would
       * close the chip on the beat it appeared.
       */
      let caretSeen = false;
      let scroller: HTMLElement | null = null;
      let hoverOpenTimer: ReturnType<typeof setTimeout> | null = null;
      let hoverCloseTimer: ReturnType<typeof setTimeout> | null = null;

      const chip = createLinkChip({
        open: (href) => {
          openSafely(href);
          close();
        },
        edit: (href) => {
          const anchor = anchorDom ? rectOf(anchorDom) : null;
          if (anchorDom) {
            try {
              const pos = view.posAtDOM(anchorDom, 0) + 1;
              const context = linkContextAt(view.state, pos);
              if (!context) throw new Error('link mark not found');
              view.dispatch(
                view.state.tr.setSelection(
                  TextSelection.create(view.state.doc, context.from, context.to),
                ),
              );
            } catch {
              close();
              return;
            }
          }
          close();
          if (anchor && href) linkPopoverFor(view)?.open(anchor, href);
        },
        async copy(href) {
          try {
            await navigator.clipboard.writeText(href);
            return true;
          } catch {
            return false;
          }
        },
        hoverChanged: (inside) => {
          if (inside) cancelHoverClose();
          else scheduleHoverClose();
        },
      });

      function cancelHoverOpen(): void {
        if (hoverOpenTimer !== null) clearTimeout(hoverOpenTimer);
        hoverOpenTimer = null;
      }

      function cancelHoverClose(): void {
        if (hoverCloseTimer !== null) clearTimeout(hoverCloseTimer);
        hoverCloseTimer = null;
      }

      function close(): void {
        cancelHoverOpen();
        cancelHoverClose();
        if (!chip.isOpen()) return;
        chip.hide();
        openHref = null;
        anchorDom = null;
        caretSeen = false;
        document.removeEventListener('pointerdown', onOutsidePointer, true);
        document.removeEventListener('keydown', onEscape, true);
        window.removeEventListener('scroll', onViewportChange, true);
        window.removeEventListener('resize', onViewportChange);
      }

      function scheduleHoverClose(): void {
        cancelHoverOpen();
        cancelHoverClose();
        hoverCloseTimer = setTimeout(close, HOVER_CLOSE_DELAY_MS);
      }

      function onOutsidePointer(event: PointerEvent): void {
        const target = event.target;
        if (target instanceof Node && chip.contains(target)) return;
        close();
      }

      function onEscape(event: KeyboardEvent): void {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        close();
        view.focus();
      }

      function onViewportChange(): void {
        if (!anchorDom || !anchorDom.isConnected) {
          close();
          return;
        }
        const anchor = rectOf(anchorDom);
        // The link itself has left the note's scroll box, so the card has
        // nothing on screen left to point at.
        if (!anchorInContainer(anchor, scroller)) {
          close();
          return;
        }
        chip.reposition(anchor);
      }

      function show(href: string, dom: HTMLElement): void {
        close();
        openHref = href;
        anchorDom = dom;
        caretSeen = currentLinkHref(view.state) === href;
        scroller = scrollContainerOf(view.dom);
        chip.show(href, rectOf(dom));
        // Capture on all three, for the same reason the proofing card uses it:
        // the note scrolls in an ancestor of the editable root, and a press or
        // an Escape elsewhere has already chosen where it is going.
        document.addEventListener('pointerdown', onOutsidePointer, true);
        document.addEventListener('keydown', onEscape, true);
        window.addEventListener('scroll', onViewportChange, true);
        window.addEventListener('resize', onViewportChange);
      }

      function scheduleHoverOpen(hit: { href: string; dom: HTMLElement }): void {
        cancelHoverClose();
        if (openHref === hit.href && anchorDom === hit.dom) return;
        cancelHoverOpen();
        hoverOpenTimer = setTimeout(() => {
          hoverOpenTimer = null;
          show(hit.href, hit.dom);
        }, HOVER_OPEN_DELAY_MS);
      }

      function onPointerOver(event: PointerEvent): void {
        const hit = linkUnder(view, event.target);
        if (hit) scheduleHoverOpen(hit);
      }

      function onPointerOut(event: PointerEvent): void {
        const hit = linkUnder(view, event.target);
        if (!hit) return;
        const next = event.relatedTarget;
        if (next instanceof Node && hit.dom.contains(next)) return;
        scheduleHoverClose();
      }

      /**
       * The guard, and the only place an anchor inside the editor is allowed to
       * mean anything. Registered in the capture phase so it decides before the
       * page row's own handler, but without stopping the event: that handler is
       * what routes a page card, and only the browser's default navigation is
       * being taken away here.
       */
      function onActivate(event: MouseEvent): void {
        cancelHoverOpen();
        const target = event.target;
        if (target instanceof Element && target.closest('a[href]')) event.preventDefault();

        const hit = linkUnder(view, event.target);
        if (!hit || event.button !== 0) {
          if (!hit) close();
          return;
        }
        if (isDirectOpen(event)) {
          close();
          openSafely(hit.href);
          return;
        }
        show(hit.href, hit.dom);
      }

      view.dom.addEventListener('click', onActivate, true);
      // The middle button, which Chromium reads as "open in a new tab" on an
      // anchor. There are no tabs here, and no window to lose the app into.
      view.dom.addEventListener('auxclick', onActivate, true);
      view.dom.addEventListener('pointerover', onPointerOver, true);
      view.dom.addEventListener('pointerout', onPointerOut, true);

      return {
        update(): void {
          if (!chip.isOpen()) return;
          if (currentLinkHref(view.state) === openHref) {
            caretSeen = true;
            if (anchorDom?.isConnected) chip.reposition(rectOf(anchorDom));
            return;
          }
          if (caretSeen) close();
        },
        destroy(): void {
          view.dom.removeEventListener('click', onActivate, true);
          view.dom.removeEventListener('auxclick', onActivate, true);
          view.dom.removeEventListener('pointerover', onPointerOver, true);
          view.dom.removeEventListener('pointerout', onPointerOut, true);
          close();
          chip.destroy();
        },
      };
    },
  });
}
