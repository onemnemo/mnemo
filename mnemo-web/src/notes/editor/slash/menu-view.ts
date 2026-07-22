/**
 * The slash menu's DOM: a floating list of rows, its selection, and nothing
 * else. It knows what to draw and which row is current; when to open, what the
 * query is and what a pick does all belong to the plugin.
 *
 * Drawn to match the desktop menu: a header naming the filter and the key that
 * closes it, then rows of name plus the markdown shortcut that does the same
 * thing. The current row swaps that shortcut for a return glyph, which is how
 * the menu says "Enter takes this one" without a second column of chrome.
 */

import type { SlashEntry } from '../registry/build';

const ROOT = 'notes-slash-menu';

export interface MenuRow {
  readonly entry: SlashEntry;
  /** Resolved once, so the language is read at build and matching agrees with it. */
  readonly label: string;
  readonly candidates: readonly string[];
}

export interface SlashMenuView {
  readonly root: HTMLElement;
  /** Redraws the rows and selects `index`. A row click reports its own index. */
  render(rows: readonly MenuRow[], index: number, onPick: (index: number) => void): void;
  select(index: number): void;
  destroy(): void;
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

export function createSlashMenuView(translate: (key: string) => string): SlashMenuView {
  const root = element('div', ROOT);
  root.setAttribute('data-hidden', '');
  // Same guard as the toolbar: the editor keeps DOM focus and, with it, the
  // caret that the query is being typed at.
  root.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });

  const header = element('div', `${ROOT}-header`);
  header.append(
    element('span', `${ROOT}-hint`, translate('SlashMenuSearchPlaceholder')),
    element('span', `${ROOT}-esc`, 'esc'),
  );

  const list = element('div', `${ROOT}-list`);
  list.setAttribute('role', 'listbox');
  const empty = element('div', `${ROOT}-empty`, translate('NoSuggestions'));
  empty.setAttribute('data-hidden', '');

  root.append(header, list, empty);
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

  function render(rows: readonly MenuRow[], index: number, onPick: (i: number) => void): void {
    list.replaceChildren();
    rowElements = rows.map((row, i) => {
      const el = element('div', `${ROOT}-row`);
      el.setAttribute('role', 'option');
      el.dataset.node = row.entry.nodeName;
      el.dataset.label = row.entry.label;
      // A rule above the first row of a new group, never on the first row of
      // the list. Drawn on the row rather than between rows so a highlight
      // cannot pick it up.
      if (i > 0 && rows[i - 1].entry.group !== row.entry.group) {
        el.classList.add('has-separator');
      }
      el.append(
        element('span', `${ROOT}-row-name`, row.label),
        element('span', `${ROOT}-row-hint`, row.entry.hint ?? ''),
        element('span', `${ROOT}-row-enter`, '⏎'),
      );
      el.addEventListener('mousedown', () => {
        onPick(i);
      });
      list.appendChild(el);
      return el;
    });
    empty.toggleAttribute('data-hidden', rows.length > 0);
    select(index);
  }

  return {
    root,
    render,
    select,
    destroy(): void {
      root.remove();
    },
  };
}
