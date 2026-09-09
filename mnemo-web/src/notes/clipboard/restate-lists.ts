/**
 * Restates foreign `<ul>` and `<ol>` lists as the item markup our schema parses.
 *
 * The schema has no list wrapper: a list is a run of sibling items, and a
 * nested list is the trailing block children of the item above it. A `<ul>`
 * from another app matches no parse rule at all, so the parser walks straight
 * through it and the items arrive as loose paragraphs. Restating keeps a list a
 * list, nesting included, with the emphasis and links in each item intact.
 *
 * Two shapes of nesting are read, because both are what real apps put on the
 * clipboard: a sub-list inside the item it belongs to, which is what the HTML
 * spec says, and a sub-list as the next sibling of that item inside the parent
 * list, which is what Google Docs writes. An item that leads with a checkbox is
 * a to-do, which is how a task list arrives from GitHub or a markdown renderer.
 */

import { isCheckbox } from './html-sanitize';
import { emptyLine, INLINE_TAGS } from './restate-markup';

const LIST_TAGS: ReadonlySet<string> = new Set(['UL', 'OL']);

/**
 * Wrappers whose content is the item's own words when they open the item. A
 * loose list puts each item's text in a `<p>`, Google Docs in a `<p>` of spans,
 * and a heading inside an item is still the item's line.
 */
const WRAPPER_TAGS: ReadonlySet<string> = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

/** Replaces every outermost list in the fragment with the items it holds. */
export function restateLists(fragment: DocumentFragment): void {
  // Outermost only: a nested list is restated by the walk from its parent, and
  // by the time this loop reaches it the walk has already emptied it.
  const outermost = Array.from(fragment.querySelectorAll('ul, ol')).filter(
    (list) => !list.parentElement?.closest('ul, ol'),
  );
  for (const list of outermost) list.replaceWith(...restatedList(list));
}

function restatedList(list: Element): Node[] {
  const numbered = list.tagName === 'OL';
  const out: Node[] = [];
  for (const child of Array.from(list.children)) {
    if (child.tagName === 'LI') {
      out.push(restatedItem(child, numbered));
    } else if (LIST_TAGS.has(child.tagName)) {
      // A sub-list beside the item it indents under, rather than inside it.
      const nested = restatedList(child);
      const previous = out[out.length - 1];
      if (previous instanceof HTMLElement && previous.tagName === 'LI') previous.append(...nested);
      else out.push(...nested);
    } else {
      // Not an item at all. It leaves the list and parses as whatever it is.
      out.push(child);
    }
  }
  return out;
}

function restatedItem(li: Element, numbered: boolean): HTMLElement {
  const item = document.createElement('li');
  const checkbox = leadingCheckbox(li);
  if (checkbox) {
    item.setAttribute('data-checklist', '');
    item.setAttribute('data-checked', String(checkbox.hasAttribute('checked')));
    checkbox.remove();
  } else {
    item.setAttribute(numbered ? 'data-numbered' : 'data-bullet', '');
  }

  const line = emptyLine();
  item.append(line);
  fillItem(item, line, li);
  return item;
}

/**
 * The checkbox an item opens with, looking through a leading wrapper for it.
 * Null when the first thing in the item is anything else.
 */
function leadingCheckbox(li: Element): Element | null {
  let node: ChildNode | null = li.firstChild;
  while (node && node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() === '') {
    node = node.nextSibling;
  }
  if (!(node instanceof Element)) return null;
  if (WRAPPER_TAGS.has(node.tagName)) return leadingCheckbox(node);
  return isCheckbox(node) ? node : null;
}

/**
 * Moves an item's content into its restated form: the item's own words on its
 * line, and everything under them as its block children, in order.
 *
 * Inline content that follows a block child opens a paragraph child of its own
 * rather than being pulled back up into the line above it, so nothing changes
 * places on the way in.
 */
function fillItem(item: HTMLElement, line: HTMLElement, source: Element): void {
  /** Where inline content goes right now. Null once a block child has closed the line. */
  let target: HTMLElement | null = line;

  const inline = (): HTMLElement => {
    if (target === null) {
      target = document.createElement('p');
      item.append(target);
    }
    return target;
  };

  /** Whether the item's line is still empty, so the next wrapper is the item's own words. */
  const opensLine = (): boolean => target === line && line.childNodes.length === 0;

  const take = (from: Element): void => {
    for (const child of Array.from(from.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        // Whitespace between two blocks is layout, not a paragraph of its own.
        if (target === null && (child.textContent ?? '').trim() === '') continue;
        inline().append(child);
      } else if (!(child instanceof Element)) {
        continue;
      } else if (LIST_TAGS.has(child.tagName)) {
        item.append(...restatedList(child));
        target = null;
      } else if (child.tagName === 'BR') {
        // The line keeps its whitespace, so a break is a real newline in it.
        inline().append('\n');
      } else if (isCheckbox(child)) {
        // A box that is not the item's own marker has no place in prose.
        continue;
      } else if (INLINE_TAGS.has(child.tagName)) {
        inline().append(child);
      } else if (opensLine() && WRAPPER_TAGS.has(child.tagName)) {
        take(child);
      } else {
        // A block of its own. It goes under the item and parses as what it is.
        item.append(child);
        target = null;
      }
    }
  };

  take(source);
}
