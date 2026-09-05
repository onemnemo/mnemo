/**
 * The slash menu: type `/` at the start of a block and pick what it becomes.
 *
 * The query lives in the document, exactly as on the desktop. There is no
 * search field: the menu reads the block's own line for what was typed after
 * the slash. What raises it is the edit that inserted that slash, never the
 * shape of the line, so a path or a route the caret is merely placed in stays
 * ordinary content and keeps Enter, the arrows, Home and End. Backspacing over
 * the slash dismisses the menu, and so does Escape, in both cases leaving the
 * typed text there to be edited. A query that stops matching any row dismisses
 * it too: a line that can no longer be a command is content again, and content
 * does not hold on to the keys the menu was borrowing.
 *
 * Rows come from the block registry, so a block type offers itself and the menu
 * has no list of its own to drift from. Their order is the registry's, which
 * already reads Text, headings, lists, quote, then the inserts.
 *
 * DOM focus never leaves the editor while this is open, so there is no focus to
 * restore on Escape: the caret is where it was, in the text that is still
 * there.
 */

import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { BlockRegistry, SlashEntry } from '../registry/build';
import type { EditorServices, SlashInsertContext } from '../registry/types';
import { asOwnUndoStep } from '../history';
import { changedRanges } from '../pipeline/invariants';
import { blockContext, hasInlineAtom } from '../commands/structure';
import { placeMenu, type Rect } from '../floating/position';
import { anchorInContainer, scrollContainerOf } from '../floating/scroll-container';
import { useI18nStore } from '../../../i18n/store';
import { createTranslate } from '../../../i18n/translate';
import { createSlashMenuView, type MenuRow } from './menu-view';
import { matchesQuery, searchCandidates } from './search';

/**
 * Where the `/` that raised the menu sits, or null while nothing raised it.
 *
 * The line's own text cannot answer this on its own: a path, a route or a date
 * starts with a slash too, so a menu opened from the shape of the line stands
 * over content written days ago and takes Enter and the caret keys with it. The
 * trigger is armed by the edit that inserts the slash and lives only while that
 * same slash is still in front of the caret, which is what lets Escape drop it
 * for good and lets a new slash raise it again.
 */
interface SlashTrigger {
  readonly pos: number;
}

export const slashMenuKey = new PluginKey<SlashTrigger | null>('mnemo-slash-menu');

/** Carried on the transaction Escape dispatches, the only way to drop a trigger early. */
const DISMISS = 'dismiss';

export interface SlashMenuOptions {
  /** Injected so a test asserts on stable keys, not on the shipped bundle. */
  readonly translate?: (key: string) => string;
  /**
   * Handed on to the row that is picked. Only the rows that reach outside the
   * document need it, the page row has to create a note before it has anything
   * to point a card at; the rest ignore it.
   */
  readonly services?: EditorServices;
}

/**
 * The typed query, or null for "the menu does not belong here".
 *
 * Three refusals, each for its own reason. A range selection is the user
 * selecting text, not typing a command. A source line is where `/` is ordinary
 * content, asked of the schema rather than matched against block names, the
 * same call the equation command makes. And a line holding an inline atom is
 * refused because picking a row clears the line, and an equation carries no
 * text of its own to warn us it was there.
 */
function readQuery(state: EditorView['state']): string | null {
  if (!state.selection.empty) return null;

  const ctx = blockContext(state);
  if (!ctx) return null;
  if (ctx.line.type.spec.code === true) return null;
  if (hasInlineAtom(ctx.line.content)) return null;

  const text = ctx.line.textBetween(0, ctx.line.content.size);
  return text.startsWith('/') ? text.slice(1) : null;
}

/**
 * The slash `tr` has just written at the start of the caret's line, if it wrote
 * one. Asking the changed ranges rather than the line text is the whole point:
 * a slash the transaction did not produce was already there.
 */
function armedTrigger(tr: Transaction, state: EditorState): SlashTrigger | null {
  if (!tr.docChanged) return null;
  if (readQuery(state) === null) return null;
  const pos = state.selection.$from.start();
  return changedRanges([tr]).some((range) => range.from <= pos && pos < range.to) ? { pos } : null;
}

function nextTrigger(
  tr: Transaction,
  current: SlashTrigger | null,
  state: EditorState,
): SlashTrigger | null {
  if (tr.getMeta(slashMenuKey) === DISMISS) return null;

  let trigger = current;
  if (trigger && tr.docChanged) {
    const mapped = tr.mapping.mapResult(trigger.pos, 1);
    trigger = mapped.deleted ? null : { pos: mapped.pos };
  }
  trigger ??= armedTrigger(tr, state);
  if (!trigger) return null;

  // The caret typing the query has to still be in it. Anywhere else, including
  // the offset in front of the slash, is the user having gone back to the text.
  const { $from, empty } = state.selection;
  return empty && $from.start() === trigger.pos && $from.pos > trigger.pos ? trigger : null;
}

function anchorRect(view: EditorView): Rect | null {
  try {
    const coords = view.coordsAtPos(view.state.selection.from);
    return { top: coords.top, bottom: coords.bottom, left: coords.left, right: coords.right };
  } catch {
    return null;
  }
}

/** Reads the active bundle at call time, so it follows a language change. */
function defaultTranslate(key: string): string {
  return createTranslate(useI18nStore.getState().bundle)('NotesEditor', key);
}

function buildRows(
  entries: readonly SlashEntry[],
  translate: (key: string) => string,
): readonly MenuRow[] {
  return entries.map((entry) => {
    const label = translate(entry.label);
    const description = translate(entry.description);
    return {
      entry,
      label,
      description,
      // Both the resolved strings and the keys behind them: the first follows
      // the UI language, the second keeps the English names findable in a UI
      // that is not in English.
      candidates: searchCandidates([
        label,
        description,
        entry.hint,
        entry.label,
        entry.nodeName,
        ...(entry.keywords ?? []),
      ]),
    };
  });
}

interface MenuController {
  sync(): void;
  handleKey(event: KeyboardEvent): boolean;
  destroy(): void;
}

function createController(
  view: EditorView,
  allRows: readonly MenuRow[],
  translate: (key: string) => string,
  services: EditorServices | undefined,
): MenuController {
  const menu = createSlashMenuView(translate);
  let open = false;
  let rows: readonly MenuRow[] = [];
  let index = 0;
  /**
   * The line the `/` was typed at, captured once when the menu opens.
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
   * Hiding the DOM is not enough on its own: the slash is still at the start of
   * the line, so the next transaction would find the same live trigger and put
   * the menu straight back. The dismissal has to be recorded in the document,
   * which is the same route Escape takes.
   */
  function dismiss(): void {
    if (!open) return;
    close();
    view.dispatch(view.state.tr.setMeta(slashMenuKey, DISMISS));
  }

  function pick(at: number): void {
    const row = rows[at];
    if (!row) return;
    // Closed first: an insert runs plugin views, and one of those seeing the
    // menu still open could pick a second time out of a document the first
    // pick has already changed.
    close();
    const context: SlashInsertContext | undefined = services
      ? // Read through a getter rather than captured: a row that awaits something
        // has to build its step against the document as it is when it returns.
        { services, currentState: () => view.state }
      : undefined;
    void row.entry.insert(
      view.state,
      (tr) => {
        // One pick is one undo step, so a single press takes the block type back
        // and leaves the typed query there to be corrected.
        view.dispatch(asOwnUndoStep(tr));
      },
      context,
    );
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
    // The vertical only. The held horizontal is deliberately the slash's, not
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
      const trigger = slashMenuKey.getState(view.state);
      const query = trigger ? readQuery(view.state) : null;
      if (query === null) {
        close();
        return;
      }

      const matched = allRows.filter((row) => matchesQuery(row.candidates, query));
      if (matched.length === 0) {
        // A query nothing can match is not a command any more, it is a path, a
        // date or a route the user is writing. The menu stands down and the
        // trigger with it, so Enter, the arrows, Home and End go back to the
        // editor instead of being swallowed by a list with nothing in it.
        close();
        view.dispatch(view.state.tr.setMeta(slashMenuKey, DISMISS));
        return;
      }

      const wasOpen = open;
      rows = matched;
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
          pick(index);
          return true;
        case 'Escape':
          // The dismissal belongs to the document, not to this view: held here
          // it would last exactly one keystroke, since the next transaction
          // would find the same slash still at the start of the line.
          view.dispatch(view.state.tr.setMeta(slashMenuKey, DISMISS));
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

export function slashMenuPlugin(registry: BlockRegistry, options: SlashMenuOptions = {}): Plugin {
  const translate = options.translate ?? defaultTranslate;
  const allRows = buildRows(registry.slash, translate);
  // Keyed by view rather than captured: one plugin instance can be reached
  // from more than one view, and the open menu is a property of the view.
  const controllers = new WeakMap<EditorView, MenuController>();

  return new Plugin<SlashTrigger | null>({
    key: slashMenuKey,
    state: {
      init: () => null,
      apply: (tr, value, _oldState, newState) => nextTrigger(tr, value, newState),
    },
    view(editorView) {
      const controller = createController(editorView, allRows, translate, options.services);
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
