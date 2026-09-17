/**
 * The DOM of a caret-anchored menu: a floating palette of rows, its group
 * headings and its selection, and nothing else. It knows what to draw and
 * which row is current; when to open, what the query is and what a pick does
 * all belong to the plugin that owns the rows.
 *
 * Each row is a tile, a name and an optional one-line description, filed
 * under its section heading, so the menu reads like a palette rather than a
 * bare list of words. The tile is a project icon for a block row and a glyph
 * for a symbol row; both draw the same way otherwise, which is what lets the
 * slash menu and the symbol palette share one view and one stylesheet.
 */

import type { IconName } from '../../../components/icon/icon-registry';
import { getIconMarkup } from '../../../components/icon/icon-registry';

const ROOT = 'notes-slash-menu';

/** Distinguishes one editor's rows from another's on the same page. */
let instanceCount = 0;

export type MenuTile = { readonly icon: IconName } | { readonly glyph: string };

export interface MenuRow {
  /** Stable name of the row, written to `data-row` so a test finds it without its text. */
  readonly key: string;
  /** i18n key of the section heading the row files under. */
  readonly group: string;
  readonly tile: MenuTile;
  /** Resolved once, so the language is read at build and matching agrees with it. */
  readonly label: string;
  /** The one-line description, resolved in the same pass; empty draws nothing. */
  readonly description: string;
}

export interface MenuView {
  readonly root: HTMLElement;
  /**
   * The list's own id. DOM focus stays in the editor while the menu is open, so
   * the editor is what has to point at this list for a screen reader to follow
   * along; it cannot be found by walking up from the focused element, because
   * the menu is a sibling of the editor rather than inside it.
   */
  readonly listId: string;
  /** The id of the row at `index`, or null when there is no such row. */
  rowId(index: number): string | null;
  /**
   * Redraws the rows and selects `index`. A row click reports its own index,
   * and so does a row the pointer moves onto: the highlight belongs to whoever
   * touched the list last, so hover and the arrow keys can never mark two rows
   * as chosen at once.
   */
  render(
    rows: readonly MenuRow[],
    index: number,
    onPick: (index: number) => void,
    onHover: (index: number) => void,
  ): void;
  select(index: number): void;
  destroy(): void;
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

/**
 * @param translate resolves the group headings and the list's name
 * @param listLabel i18n key naming the list for a screen reader
 */
export function createMenuView(translate: (key: string) => string, listLabel: string): MenuView {
  // `scroll-thin` is the app's own scrollbar; the menu is the one place in the
  // note that scrolls without it otherwise, and a system scrollbar down the side
  // of a floating palette is the loudest thing in it. The pop-in replays on
  // every open by itself: the menu is hidden with `display: none` between them,
  // and an element coming back from that starts its animations again.
  const root = element('div', `${ROOT} scroll-thin animate-pop-in`);
  root.setAttribute('data-hidden', '');
  // The editor keeps DOM focus and, with it, the caret the query is typed at.
  root.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });

  const listId = `${ROOT}-list-${String(++instanceCount)}`;
  const list = element('div', `${ROOT}-list`);
  list.id = listId;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', translate(listLabel));
  const empty = element('div', `${ROOT}-empty`, translate('NoSuggestions'));
  empty.setAttribute('data-hidden', '');

  root.append(list, empty);
  document.body.appendChild(root);

  let rowElements: HTMLElement[] = [];

  function select(index: number): void {
    rowElements.forEach((el, i) => {
      const current = i === index;
      el.classList.toggle('is-selected', current);
      el.setAttribute('aria-selected', String(current));
    });
    const selected = rowElements[index];
    // Keeps the current row in view when the arrow keys walk past the fold.
    // `scrollIntoView` is not available in jsdom, so this is guarded rather
    // than assumed present.
    if (selected && typeof selected.scrollIntoView === 'function') {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }

  function tile(kind: MenuTile): HTMLElement {
    const span = element('span', `${ROOT}-row-tile`);
    if ('glyph' in kind) {
      span.classList.add(`${ROOT}-row-glyph`);
      span.textContent = kind.glyph;
      return span;
    }
    const markup = getIconMarkup(kind.icon);
    if (markup) span.innerHTML = markup;
    return span;
  }

  function render(
    rows: readonly MenuRow[],
    index: number,
    onPick: (i: number) => void,
    onHover: (i: number) => void,
  ): void {
    list.replaceChildren();
    let lastGroup: string | null = null;
    rowElements = rows.map((row, i) => {
      // A heading over the first row of each new section, drawn as its own
      // element so a hovered or selected row cannot pick it up.
      if (row.group !== lastGroup) {
        lastGroup = row.group;
        list.appendChild(element('div', `${ROOT}-group`, translate(row.group)));
      }

      const el = element('div', `${ROOT}-row`);
      el.id = `${listId}-row-${String(i)}`;
      el.setAttribute('role', 'option');
      el.dataset.row = row.key;

      const text = element('span', `${ROOT}-row-text`);
      text.appendChild(element('span', `${ROOT}-row-name`, row.label));
      if (row.description.length > 0) {
        text.appendChild(element('span', `${ROOT}-row-desc`, row.description));
      }
      el.append(tile(row.tile), text);

      el.addEventListener('mousedown', () => {
        onPick(i);
      });
      el.addEventListener('mouseenter', () => {
        onHover(i);
      });
      list.appendChild(el);
      return el;
    });
    empty.toggleAttribute('data-hidden', rows.length > 0);
    select(index);
  }

  return {
    root,
    listId,
    rowId(index): string | null {
      return rowElements[index]?.id ?? null;
    },
    render,
    select,
    destroy(): void {
      root.remove();
    },
  };
}
