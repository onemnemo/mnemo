/**
 * A menu raised by a typed character and anchored to the caret: the plugin
 * state that tracks the trigger, the controller that opens, places and walks
 * the list, and the keys it borrows while open. The slash menu and the symbol
 * palette are both this, with their own rows, their own trigger and their own
 * idea of what a pick does.
 *
 * The query lives in the document, exactly as on the desktop. There is no
 * search field: the menu reads the caret's own token for what was typed after
 * the trigger. What raises it is the edit that inserted that trigger, never
 * the shape of the line, so a path or a route the caret is merely placed in
 * stays ordinary content and keeps Enter, the arrows, Home and End.
 * Backspacing over the trigger dismisses the menu, and so does Escape, in both
 * cases leaving the typed text there to be edited.
 *
 * DOM focus never leaves the editor while this is open, so there is no focus
 * to restore on Escape: the caret is where it was, in the text that is still
 * there.
 */

import { Plugin, type EditorState, type PluginKey, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { changedRanges } from '../pipeline/invariants';
import { isHistoryRestore } from '../history';
import { placeMenu, type Rect } from '../floating/position';
import { anchorInContainer, scrollContainerOf } from '../floating/scroll-container';
import { readToken, type TokenReader, type TriggerToken } from './caret-token';
import { createMenuView, type MenuRow } from './menu-view';

/**
 * Where the trigger that raised the menu sits, or null while nothing raised it.
 *
 * The line's own text cannot answer this on its own: a path, a route or a date
 * holds a slash too, so a menu opened from the shape of the line stands over
 * content written days ago and takes Enter and the caret keys with it. The
 * trigger is armed by the edit that inserts the character and lives only while
 * the caret is still at the end of the token it started, which is what lets
 * Escape drop it for good and lets a new trigger raise it again.
 */
export interface CaretTrigger {
  readonly pos: number;
}

/** Carried on the transaction Escape dispatches, the only way to drop a trigger early. */
const DISMISS = 'dismiss';

export interface CaretMenuSpec<Row extends MenuRow> {
  readonly key: PluginKey<CaretTrigger | null>;
  readonly reader: TokenReader;
  /** Resolves the group headings and the list's name. */
  readonly translate: (key: string) => string;
  /** i18n key naming the list for a screen reader. */
  readonly listLabel: string;
  /** The rows the query leaves standing, in the order they are drawn. */
  rows(query: string): readonly Row[];
  /**
   * What a pick does. The menu is already closed and the trigger still
   * recorded when this runs; `token` is what the pick replaces.
   */
  pick(view: EditorView, row: Row, token: TriggerToken): void;
  /**
   * Whether a query nothing matches ends the trigger for good. The slash menu
   * does: a line that can no longer be a command is content again, and content
   * does not hold on to the keys the menu was borrowing. The palette only
   * hides, so a corrected typo brings it straight back.
   */
  readonly dismissOnNoMatch: boolean;
  /**
   * Whether Enter on the bare trigger, with nothing typed after it, picks the
   * first row. The slash menu does, which is how the list is discovered. The
   * palette does not: a lone backslash at the end of a line is ordinary prose,
   * and Enter there means a new line, not the last symbol picked.
   */
  readonly picksOnBareTrigger: boolean;
}

/**
 * The trigger `tr` has just typed at the start of the caret's token, if it
 * typed one. Asking the changed ranges rather than the line text is the whole
 * point: a trigger the transaction did not produce was already there. Typing
 * is a one character change; a paste, a drop, an undo or a redo that lands a
 * whole token is the user's text or their own past, and neither asked for a
 * menu, so a wider change arms nothing, and a restore or a paste arms nothing
 * even when it lands a single character.
 */
function armedTrigger(tr: Transaction, state: EditorState, reader: TokenReader): CaretTrigger | null {
  if (!tr.docChanged) return null;
  if (isHistoryRestore(tr) || tr.getMeta('paste') === true || tr.getMeta('uiEvent') === 'drop') return null;
  const token = readToken(state, reader);
  if (!token) return null;
  const pos = token.from;
  const typed = changedRanges([tr]).some(
    (range) => range.from <= pos && pos < range.to && range.to - range.from === 1,
  );
  return typed ? { pos } : null;
}

function nextTrigger(
  tr: Transaction,
  current: CaretTrigger | null,
  state: EditorState,
  key: PluginKey<CaretTrigger | null>,
  reader: TokenReader,
): CaretTrigger | null {
  if (tr.getMeta(key) === DISMISS) return null;

  let trigger = current;
  if (trigger && tr.docChanged) {
    const mapped = tr.mapping.mapResult(trigger.pos, 1);
    trigger = mapped.deleted ? null : { pos: mapped.pos };
  }
  trigger ??= armedTrigger(tr, state, reader);
  if (!trigger) return null;

  // The caret typing the query has to still be at the end of the token.
  // Anywhere else, including the offset in front of the trigger, is the user
  // having gone back to the text.
  return readToken(state, reader, trigger.pos) ? trigger : null;
}

function anchorRect(view: EditorView): Rect | null {
  try {
    const coords = view.coordsAtPos(view.state.selection.from);
    return { top: coords.top, bottom: coords.bottom, left: coords.left, right: coords.right };
  } catch {
    return null;
  }
}

interface MenuController {
  sync(): void;
  handleKey(event: KeyboardEvent): boolean;
  destroy(): void;
}

function createController<Row extends MenuRow>(view: EditorView, spec: CaretMenuSpec<Row>): MenuController {
  const menu = createMenuView(spec.translate, spec.listLabel);
  let open = false;
  let rows: readonly Row[] = [];
  let index = 0;
  let query = '';
  /**
   * The line the trigger was typed at, captured once when the menu opens.
   *
   * Held rather than re-read because the two things that change while the menu
   * is up pull in opposite directions: the caret walks right as the query is
   * typed, which would make the menu crawl sideways, while the list shrinks as
   * the query narrows it, which a menu placed *above* the line has to follow or
   * it drifts up off the text it belongs to.
   */
  let anchor: Rect | null = null;
  /**
   * The box the caret has to stay inside, resolved once per open.
   *
   * The note scrolls in an ancestor of the editable root rather than in the
   * window, so a caret can leave the note while its coordinates are still
   * perfectly valid ones for the window. Resolved at open rather than on every
   * scroll frame, since walking the ancestors reads computed style.
   */
  let scroller: HTMLElement | null = null;

  /**
   * Points the editor at the open list and at the row the arrows are on.
   *
   * The editable element keeps DOM focus the whole time the menu is up, which
   * is what lets the query go on being typed. That makes the editor the only
   * element a screen reader is looking at, so the list and its current row have
   * to be named from there rather than from the menu.
   */
  function syncEditorAria(): void {
    const { dom } = view;
    if (!open) {
      dom.removeAttribute('aria-expanded');
      dom.removeAttribute('aria-controls');
      dom.removeAttribute('aria-activedescendant');
      return;
    }
    dom.setAttribute('aria-expanded', 'true');
    dom.setAttribute('aria-controls', menu.listId);
    const active = menu.rowId(index);
    if (active) dom.setAttribute('aria-activedescendant', active);
    else dom.removeAttribute('aria-activedescendant');
  }

  function close(): void {
    if (!open) return;
    open = false;
    anchor = null;
    scroller = null;
    menu.root.setAttribute('data-hidden', '');
    syncEditorAria();
  }

  /**
   * Closes for good, the answer to everything that is not the query changing.
   *
   * Hiding the DOM is not enough on its own: the trigger is still in front of
   * the caret, so the next transaction would find the same live trigger and put
   * the menu straight back. The dismissal has to be recorded in the document,
   * which is the same route Escape takes.
   */
  function dismiss(): void {
    if (!open) return;
    close();
    view.dispatch(view.state.tr.setMeta(spec.key, DISMISS));
  }

  function pick(at: number): void {
    const row = rows[at];
    if (!row) return;
    const trigger = spec.key.getState(view.state);
    const token = trigger ? readToken(view.state, spec.reader, trigger.pos) : null;
    if (!token) return;
    // Closed first: an insert runs plugin views, and one of those seeing the
    // menu still open could pick a second time out of a document the first
    // pick has already changed.
    close();
    spec.pick(view, row, token);
  }

  function reposition(): void {
    if (!anchor) return;
    // Measured with any previous cap cleared, so the height that feeds the
    // placement is what the menu wants rather than what it was last allowed.
    menu.root.style.maxHeight = '';
    const size = { width: menu.root.offsetWidth, height: menu.root.offsetHeight };
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const placement = placeMenu(anchor, size, viewport);
    menu.root.style.maxHeight = `${String(placement.maxHeight)}px`;
    menu.root.style.top = `${String(placement.top)}px`;
    menu.root.style.left = `${String(placement.left)}px`;
  }

  /** The one place the chosen row changes, whether a key or the pointer chose it. */
  function choose(at: number): void {
    if (at === index || at < 0 || at >= rows.length) return;
    index = at;
    menu.select(index);
    syncEditorAria();
  }

  function move(delta: number): void {
    if (rows.length === 0) return;
    // Clamped, not wrapped: the desktop clamps, and a list this short reads as
    // a broken key when the highlight jumps end to end.
    choose(Math.min(rows.length - 1, Math.max(0, index + delta)));
  }

  /**
   * A press anywhere that is neither the document nor the menu itself.
   *
   * The menu is a body-level element outside the editor, so nothing about a
   * press on the note tree, a tab or the topbar reaches the plugin any other
   * way: none of them dispatches a transaction, and the only state this reacts
   * to is the document's.
   */
  function onOutsidePointer(event: PointerEvent): void {
    if (!open) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (view.dom.contains(target) || menu.root.contains(target)) return;
    dismiss();
  }

  function onViewportChange(): void {
    if (!open || !anchor) return;
    const fresh = anchorRect(view);
    // The vertical only. The held horizontal is deliberately the trigger's, not
    // the caret's, and taking the caret's here would slide the menu right by
    // the width of whatever has been typed since it opened.
    if (fresh) anchor = { ...anchor, top: fresh.top, bottom: fresh.bottom };
    if (!anchorInContainer(anchor, scroller)) {
      dismiss();
      return;
    }
    reposition();
  }

  // Capture, because the note scrolls in an ancestor of the editable root and a
  // scroll event on that ancestor never reaches the window by bubbling.
  document.addEventListener('pointerdown', onOutsidePointer, true);
  window.addEventListener('scroll', onViewportChange, true);
  window.addEventListener('resize', onViewportChange);

  return {
    sync(): void {
      const trigger = spec.key.getState(view.state);
      const token = trigger ? readToken(view.state, spec.reader, trigger.pos) : null;
      // Nothing opens mid-composition. The token an input method is still
      // writing is intermediate text, and a pick would replace a range the
      // IME believes it owns.
      if (!token || view.composing) {
        close();
        return;
      }

      const matched = spec.rows(token.query);
      if (matched.length === 0) {
        close();
        if (spec.dismissOnNoMatch) view.dispatch(view.state.tr.setMeta(spec.key, DISMISS));
        return;
      }

      const wasOpen = open;
      rows = matched;
      query = token.query;
      // Back to the top on every query change, matching the desktop: the row
      // the user was on is rarely the one they still mean after typing more.
      index = 0;
      open = true;
      menu.root.removeAttribute('data-hidden');
      menu.render(rows, index, pick, choose);
      syncEditorAria();
      // The anchor is taken once; the placement is redone on every query, since
      // the list it is placing has just changed size.
      if (!wasOpen) {
        anchor = anchorRect(view);
        scroller = scrollContainerOf(view.dom);
      }
      reposition();
    },

    handleKey(event): boolean {
      if (!open) return false;
      switch (event.key) {
        case 'ArrowDown':
          move(1);
          return true;
        case 'ArrowUp':
          move(-1);
          return true;
        case 'Home':
          move(-rows.length);
          return true;
        case 'End':
          move(rows.length);
          return true;
        case 'Enter':
          // The menu is only ever open over rows that match, so Enter always
          // has something to pick; a query that matches nothing closes it in
          // `sync` and this handler declines with it.
          if (query.length === 0 && !spec.picksOnBareTrigger) return false;
          pick(index);
          return true;
        case 'Escape':
          // The dismissal belongs to the document, not to this view: held here
          // it would last exactly one keystroke, since the next transaction
          // would find the same trigger still in front of the caret.
          view.dispatch(view.state.tr.setMeta(spec.key, DISMISS));
          return true;
        default:
          return false;
      }
    },

    destroy(): void {
      document.removeEventListener('pointerdown', onOutsidePointer, true);
      window.removeEventListener('scroll', onViewportChange, true);
      window.removeEventListener('resize', onViewportChange);
      // Before the menu goes, so the editor is not left pointing at a list that
      // is no longer in the document.
      close();
      menu.destroy();
    },
  };
}

export function caretMenuPlugin<Row extends MenuRow>(spec: CaretMenuSpec<Row>): Plugin<CaretTrigger | null> {
  // Keyed by view rather than captured: one plugin instance can be reached
  // from more than one view, and the open menu is a property of the view.
  const controllers = new WeakMap<EditorView, MenuController>();

  return new Plugin<CaretTrigger | null>({
    key: spec.key,
    state: {
      init: () => null,
      apply: (tr, value, _oldState, newState) => nextTrigger(tr, value, newState, spec.key, spec.reader),
    },
    view(editorView) {
      const controller = createController(editorView, spec);
      controllers.set(editorView, controller);
      controller.sync();
      return {
        update(): void {
          controller.sync();
        },
        destroy(): void {
          controllers.delete(editorView);
          controller.destroy();
        },
      };
    },
    props: {
      handleKeyDown(view, event) {
        return controllers.get(view)?.handleKey(event) ?? false;
      },
    },
  });
}
