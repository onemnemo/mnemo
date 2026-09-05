/**
 * The floating inline formatting toolbar, ported from the desktop's
 * `InlineFormattingToolbar`.
 *
 * A ProseMirror plugin rather than a React component: `Plugin.view()` runs on
 * every state change, including the raw `updateState` the chunked mount uses,
 * so there is no dispatch wrapping and no effect ordering to get right.
 *
 * Buttons and their highlights both read the command catalog, so a button
 * cannot disagree with what its own shortcut does.
 *
 * The desktop toolbar is `Focusable="False"`, so nothing here has a keyboard
 * story to port. It gets one anyway: Alt+F10 moves into it, the arrows walk it,
 * and Escape hands the caret back where it was. A control that only a pointer
 * can reach is a control some people do not have.
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import {
  EDITOR_COMMANDS,
  isCommandEnabled,
  type DirectCommand,
  type EditorCommand,
  type SwatchCommand,
} from '../commands/catalog';
import { canEditLink, isLinkActive } from '../marks/link-commands';
import { getIconMarkup } from '../../../components/icon/icon-registry';
import { useI18nStore } from '../../../i18n/store';
import { createTranslate } from '../../../i18n/translate';
import { BACKGROUND_SWATCHES, TEXT_SWATCHES, type SwatchCell } from './palette';
import { placePopover, placeToolbar, type Rect } from '../floating/position';
import { anchorInContainer, scrollContainerOf } from '../floating/scroll-container';
import { createRovingFocus } from '../floating/roving-focus';
import { openTransientFocus, type TransientFocusScope } from '../focus';
import { createLinkPopover, type LinkPopoverHandle } from './link-popover';

const ROOT = 'notes-formatting-toolbar';

/**
 * The chord that moves focus into the toolbar, as CKEditor and TinyMCE have
 * both spelled it for years. Alt is what keeps it off F10's own browser
 * meaning, and an editor user who knows the convention already knows this.
 */
const FOCUS_CHORD = 'F10';

/** Distinguishes one editor's swatch headings from another's on the same page. */
let instanceCount = 0;

/**
 * Counts transactions that set the selection deliberately rather than having
 * it remapped underneath them.
 *
 * Comparing two states cannot tell those apart, since typing shifts every
 * position after the caret and a selection nobody touched still fails `.eq()`.
 * Only the transaction knows, via `selectionSet`. A counter rather than a flag
 * because several transactions can land between two `update` calls.
 */
const selectionSetCounter = new PluginKey<number>('mnemo-toolbar-selection-set');

/**
 * Tooltip keys, in the `NotesEditor` namespace the desktop already ships
 * translations under. Not the catalog's `titleKey`, which names the command
 * for list surfaces; the toolbar hover has its own shorter string.
 */
const TOOLTIP_KEYS: Readonly<Record<string, string>> = {
  'editor.bold': 'BoldTooltip',
  'editor.italic': 'ItalicTooltip',
  'editor.underline': 'UnderlineTooltip',
  'editor.strikethrough': 'StrikethroughTooltip',
  'editor.link': 'LinkTooltip',
  'editor.highlight': 'HighlightTooltip',
  'editor.code': 'InlineCodeTooltip',
  'editor.subscript': 'SubscriptTooltip',
  'editor.superscript': 'SuperscriptTooltip',
  'editor.equation': 'EquationTooltip',
};

/**
 * The buttons shown, in order, and the divider groups around them, matching
 * the desktop toolbar's `Bold Italic Underline Strikethrough Link Highlight`
 * run. `editor.link` is a sentinel, not a catalog id: it names where the
 * bespoke link button (built below, alongside the colour button) sits in the
 * row, since a command that opens UI cannot live in the catalog `run` slot
 * `isCommandEnabled` dry-runs. `editor.code` has no desktop button to match
 * against, so it is appended to the same group; clear-marks and undo/redo
 * stay with the slash menu and keymap.
 */
const BUTTON_GROUPS: readonly (readonly string[])[] = [
  [
    'editor.bold',
    'editor.italic',
    'editor.underline',
    'editor.strikethrough',
    'editor.link',
    'editor.highlight',
    'editor.code',
  ],
  ['editor.subscript', 'editor.superscript', 'editor.equation'],
];

/**
 * How long an emptied selection is given to come back before the toolbar goes
 * away. Ports the desktop's 80ms close debounce: a selection can be empty for a
 * frame in the middle of an interaction, and hiding on the first empty report
 * makes the bubble blink.
 */
const CLOSE_DELAY_MS = 80;

export interface FormattingToolbarOptions {
  readonly commands?: readonly EditorCommand[];
  /**
   * Resolves a `NotesEditor` key to its label. Injected rather than imported
   * so the plugin stays free of the store, and so a test can assert on stable
   * keys instead of on whatever the shipped bundle currently says.
   */
  readonly translate?: (key: string) => string;
  /** Overridable so a test can prove the delay rather than wait it out. */
  readonly closeDelayMs?: number;
}

/**
 * A catalog-backed button runs a fixed `Command` and reads its highlight from
 * the same catalog entry. A link button has neither, a fixed href to apply or
 * a meaningful dry run, its state comes from the mark at the selection, and
 * clicking it opens the popover rather than running anything, so it is its
 * own kind rather than a `DirectCommand` faked up to fit the shape the dry
 * run in `isCommandEnabled` would otherwise call on every selection change.
 */
type ToolbarButton =
  | { readonly kind: 'command'; readonly el: HTMLButtonElement; readonly command: DirectCommand }
  | { readonly kind: 'link'; readonly el: HTMLButtonElement };

interface SwatchCellButton {
  readonly el: HTMLButtonElement;
  readonly cell: SwatchCell;
}

interface ToolbarDom {
  readonly root: HTMLElement;
  readonly colorButton: HTMLButtonElement;
  readonly colorPreview: HTMLElement;
  readonly colorLabel: HTMLElement;
  readonly buttons: readonly ToolbarButton[];
  readonly popover: HTMLElement;
  readonly textCells: readonly SwatchCellButton[];
  readonly backgroundCells: readonly SwatchCellButton[];
}

function iconSpan(name: string | undefined): HTMLElement {
  const span = document.createElement('span');
  span.className = `${ROOT}-icon`;
  if (name) {
    const markup = getIconMarkup(name);
    if (markup) span.innerHTML = markup;
  }
  return span;
}

function divider(): HTMLElement {
  const el = document.createElement('div');
  el.className = `${ROOT}-divider`;
  return el;
}

/**
 * A row of swatch cells. Text cells draw an "A" in the colour and background
 * cells a filled tile, matching the desktop picker; the background row's
 * clearing cell uses the `ban` icon.
 */
function buildSwatchRow(
  cells: readonly SwatchCell[],
  variant: 'text' | 'background',
  translate: (key: string) => string,
  headerId: string,
): { readonly row: HTMLElement; readonly cellButtons: readonly SwatchCellButton[] } {
  const row = document.createElement('div');
  row.className = `${ROOT}-swatch-row`;
  // Named by the heading already drawn above it, so the two rows are told apart
  // without a second string that could drift from the visible one.
  row.setAttribute('role', 'group');
  row.setAttribute('aria-labelledby', headerId);
  const cellButtons = cells.map((cell): SwatchCellButton => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `${ROOT}-swatch-cell`;
    el.tabIndex = -1;
    // The token identifies the cell for styling and for tests, which must not
    // key off a label that changes with the active language.
    el.dataset.token = cell.token ?? 'none';
    if (cell.cssVar) el.style.setProperty('--swatch-cell-color', `var(${cell.cssVar})`);

    if (variant === 'text') {
      el.classList.add(`${ROOT}-swatch-cell-glyph`);
      el.textContent = 'A';
    } else if (cell.cssVar) {
      el.classList.add(`${ROOT}-swatch-cell-filled`);
    } else {
      el.appendChild(iconSpan('formatting-toolbar/ban'));
    }

    if (cell.labelKey) el.title = translate(cell.labelKey);
    row.appendChild(el);
    return { el, cell };
  });
  return { row, cellButtons };
}

function buildToolbarDom(
  commandsById: ReadonlyMap<string, EditorCommand>,
  translate: (key: string) => string,
): ToolbarDom {
  const root = document.createElement('div');
  root.className = ROOT;
  root.setAttribute('data-hidden', '');
  root.setAttribute('role', 'toolbar');
  root.setAttribute('aria-orientation', 'horizontal');
  root.setAttribute('aria-label', translate('FormattingToolbar'));
  // Keeps focus, and with it the selection, from leaving the editor when a
  // control here is pressed. One guard at the root covers every control.
  root.addEventListener('mousedown', (event) => event.preventDefault());

  const colorButton = document.createElement('button');
  colorButton.type = 'button';
  colorButton.className = `${ROOT}-color`;
  // The group's entry point until the arrows move it, so the toolbar is one
  // tab stop rather than nine.
  colorButton.tabIndex = 0;
  colorButton.setAttribute('aria-haspopup', 'true');
  colorButton.setAttribute('aria-expanded', 'false');
  // `Color`, not `TextColor`: the button opens both rows, and `TextColor` is
  // the popover's own heading, which is upper case and reads as shouting in a
  // tooltip. Matches the key the desktop toolbar uses for this button.
  colorButton.title = translate('Color');
  const colorPreview = document.createElement('span');
  colorPreview.className = `${ROOT}-color-preview`;
  colorPreview.textContent = 'A';
  // The desktop draws this button as swatch, word, chevron. It is the only
  // labelled control on the toolbar, which is what makes the colour row
  // findable without hovering everything.
  const colorLabel = document.createElement('span');
  colorLabel.className = `${ROOT}-color-label`;
  colorLabel.textContent = translate('Color');
  colorButton.append(colorPreview, colorLabel, iconSpan('common/chevron-down'));
  root.appendChild(colorButton);
  root.appendChild(divider());

  const buttons: ToolbarButton[] = [];
  BUTTON_GROUPS.forEach((ids, index) => {
    for (const id of ids) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `${ROOT}-btn`;
      el.dataset.command = id;
      el.tabIndex = -1;
      const tooltipKey = TOOLTIP_KEYS[id];
      if (tooltipKey) {
        el.title = translate(tooltipKey);
        // Spelled out rather than left to the title fallback: the equation
        // button draws a sigma, and a glyph wins over `title` as the name.
        el.setAttribute('aria-label', el.title);
      }

      if (id === 'editor.link') {
        el.setAttribute('aria-haspopup', 'true');
        el.setAttribute('aria-pressed', 'false');
        el.appendChild(iconSpan('formatting-toolbar/link'));
        root.appendChild(el);
        buttons.push({ kind: 'link', el });
        continue;
      }

      const command = commandsById.get(id);
      if (!command || command.kind !== 'direct') continue;
      // A toggle says whether it is on; an insert has nothing to be on about,
      // and the catalog already draws that line with `isActive`.
      if (command.isActive) el.setAttribute('aria-pressed', 'false');
      if (id === 'editor.equation') {
        el.classList.add(`${ROOT}-btn-glyph`);
        el.textContent = 'Σ';
      } else {
        el.appendChild(iconSpan(command.icon));
      }
      root.appendChild(el);
      buttons.push({ kind: 'command', el, command });
    }
    if (index < BUTTON_GROUPS.length - 1) root.appendChild(divider());
  });

  const popover = document.createElement('div');
  popover.className = `${ROOT}-swatch-popover`;
  popover.setAttribute('data-hidden', '');

  const scope = `${ROOT}-${String(++instanceCount)}`;
  const textHeader = document.createElement('div');
  textHeader.className = `${ROOT}-swatch-header`;
  textHeader.id = `${scope}-text-header`;
  textHeader.textContent = translate('TextColor');
  const backgroundHeader = document.createElement('div');
  backgroundHeader.className = `${ROOT}-swatch-header`;
  backgroundHeader.id = `${scope}-background-header`;
  backgroundHeader.textContent = translate('BackgroundColor');

  // Clicks are wired in by the plugin, which is what holds the live view.
  const text = buildSwatchRow(TEXT_SWATCHES, 'text', translate, textHeader.id);
  const background = buildSwatchRow(BACKGROUND_SWATCHES, 'background', translate, backgroundHeader.id);
  popover.append(textHeader, text.row, backgroundHeader, background.row);
  root.appendChild(popover);

  return {
    root,
    colorButton,
    colorPreview,
    colorLabel,
    buttons,
    popover,
    textCells: text.cellButtons,
    backgroundCells: background.cellButtons,
  };
}

/**
 * The selection's screen rect, or null when it cannot be measured: a reshaped
 * document, or an environment with no layout engine. Callers skip
 * repositioning rather than crash, leaving the toolbar where it was.
 */
function measureAnchor(view: EditorView): Rect | null {
  try {
    const { from, to } = view.state.selection;
    const start = view.coordsAtPos(from);
    const end = view.coordsAtPos(to);
    return {
      top: Math.min(start.top, end.top),
      bottom: Math.max(start.bottom, end.bottom),
      left: Math.min(start.left, end.left),
      right: Math.max(start.right, end.right),
    };
  } catch {
    return null;
  }
}

/** Reads the active bundle at call time, so it follows a language change. */
function defaultTranslate(key: string): string {
  return createTranslate(useI18nStore.getState().bundle)('NotesEditor', key);
}

const isMac = typeof navigator !== 'undefined' && /Mac|iP(hone|[oa]d)/.test(navigator.platform);

/**
 * The desktop's `editor.link` chord (`Primary+Shift+L` in
 * `EditorKeybindManifest.Chords`), matched by hand rather than through
 * `editorKeymap`'s catalog-driven binding: this command opens UI, which is
 * exactly what a catalog `run` must not do, `isCommandEnabled` dry-runs every
 * entry with no `dispatch` on every selection change. `Mod` follows
 * `prosemirror-keymap`'s own reading of it, Cmd on Mac, Ctrl elsewhere.
 */
function isLinkChord(event: KeyboardEvent): boolean {
  const mod = isMac ? event.metaKey : event.ctrlKey;
  return mod && event.shiftKey && event.key.toLowerCase() === 'l';
}

/** The plugin to include in a note's editable `EditorState` plugins. */
export function formattingToolbarPlugin(options: FormattingToolbarOptions = {}): Plugin {
  const commands = options.commands ?? EDITOR_COMMANDS;
  const commandsById = new Map(commands.map((command) => [command.id, command] as const));
  const foreground = commandsById.get('editor.color.foreground') as SwatchCommand | undefined;
  const background = commandsById.get('editor.color.background') as SwatchCommand | undefined;
  const translate = options.translate ?? defaultTranslate;
  const closeDelayMs = options.closeDelayMs ?? CLOSE_DELAY_MS;
  // Keyed by view rather than captured: one plugin instance can be reached from
  // more than one view, and the toolbar to focus is the one this view owns.
  const focusEntries = new WeakMap<EditorView, () => boolean>();
  // The link popover instance for each view, so the `Mod-Shift-l` handler
  // below can reach the same popover the toolbar button opens.
  const linkEntries = new WeakMap<EditorView, LinkPopoverHandle>();

  return new Plugin({
    state: {
      init: () => 0,
      apply: (tr, count) => (tr.selectionSet ? count + 1 : count),
    },
    key: selectionSetCounter,
    view(editorView) {
      const dom = buildToolbarDom(commandsById, translate);
      document.body.appendChild(dom.root);
      const linkPopover = createLinkPopover(editorView);
      linkEntries.set(editorView, linkPopover);

      let visible = false;
      let popoverOpen = false;
      // ProseMirror keeps its selection when focus leaves, so without this the
      // bubble would hang over the page after the user has moved on. Cleared
      // by the next deliberate selection change.
      let dismissed = false;
      // True between a press inside the editor and its release: the selection
      // is being dragged out and every intermediate state is noise.
      let selecting = false;
      let closeTimer: ReturnType<typeof setTimeout> | null = null;
      // Non-null exactly while the keyboard is driving the toolbar. It holds the
      // selection to hand back, so Escape returns the caret rather than leaving
      // it wherever the document happens to have moved it.
      let focusScope: TransientFocusScope | null = null;
      // The selection is off the note's scroll box, so there is nothing on
      // screen to point at. Decided in `reposition` and re-applied by `sync`,
      // which shows the toolbar again without necessarily re-measuring.
      let culled = false;

      // The toolbar is a row; the palette is a grid of two. Both read their
      // controls live, because which ones are available moves with the caret.
      const toolbarFocus = createRovingFocus(() => [
        [dom.colorButton, ...dom.buttons.map((button) => button.el)],
      ]);
      const paletteFocus = createRovingFocus(() => [
        dom.textCells.map((cell) => cell.el),
        dom.backgroundCells.map((cell) => cell.el),
      ]);

      function holdsFocus(): boolean {
        return dom.root.contains(document.activeElement);
      }

      /**
       * The box the selection has to stay inside to be worth pointing at.
       *
       * Resolved on first use and kept, since walking the ancestors reads
       * computed style and this is asked on every scroll frame. The editable
       * root does not move between scrollers for the life of one view.
       */
      let scroller: HTMLElement | null = null;
      let scrollerResolved = false;
      function noteScroller(view: EditorView): HTMLElement | null {
        if (!scrollerResolved) {
          scroller = scrollContainerOf(view.dom);
          scrollerResolved = true;
        }
        return scroller;
      }

      function cancelScheduledClose(): void {
        if (closeTimer === null) return;
        clearTimeout(closeTimer);
        closeTimer = null;
      }

      function closePopover(): void {
        if (!popoverOpen) return;
        popoverOpen = false;
        dom.popover.setAttribute('data-hidden', '');
        dom.colorButton.setAttribute('aria-expanded', 'false');
        // Focus cannot stay on a cell that is no longer drawn; it goes back to
        // the control that opened the popover, never out of the toolbar.
        if (dom.popover.contains(document.activeElement)) dom.colorButton.focus();
      }

      /**
       * Keeps the palette on screen. Measured only while it is showing: a
       * hidden popover is `display: none`, and placing against nothing gives
       * the answer for a panel with no size.
       */
      function positionPopover(): void {
        if (!popoverOpen) return;
        const anchor = dom.root.getBoundingClientRect();
        const size = { width: dom.popover.offsetWidth, height: dom.popover.offsetHeight };
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        const placement = placePopover(anchor, size, viewport);
        dom.popover.style.left = `${String(placement.left)}px`;
        dom.popover.classList.toggle(`${ROOT}-swatch-popover-above`, placement.showAbove);
      }

      function openPopover(): void {
        if (popoverOpen) return;
        popoverOpen = true;
        dom.popover.removeAttribute('data-hidden');
        dom.colorButton.setAttribute('aria-expanded', 'true');
        positionPopover();
        paletteFocus.reset();
        // Only when the keyboard opened it. A click already left focus in the
        // document on purpose, and pulling it into the palette would take the
        // caret away from a user who never asked to leave the text.
        if (holdsFocus()) paletteFocus.focus();
      }

      function hide(): void {
        cancelScheduledClose();
        if (!visible) return;
        const hadFocus = holdsFocus();
        visible = false;
        culled = false;
        dom.root.setAttribute('data-hidden', '');
        closePopover();
        linkPopover.close();
        toolbarFocus.reset();
        if (focusScope) {
          // Whatever emptied the selection has already put it where it wants
          // it, so the scope stands down rather than restoring the old one.
          focusScope.release();
          focusScope = null;
          if (hadFocus) editorView.focus();
        }
      }

      /** Moves the keyboard into the toolbar, capturing what to hand back. */
      function focusToolbar(): boolean {
        if (!visible || !toolbarFocus.focus()) return false;
        focusScope ??= openTransientFocus(editorView);
        return true;
      }

      /** Escape's answer: the caret goes back exactly where it was. */
      function returnFocusToEditor(): void {
        const scope = focusScope;
        focusScope = null;
        toolbarFocus.reset();
        if (scope) scope.restore();
        else editorView.focus();
      }

      /**
       * Hides once the selection has been empty for {@link CLOSE_DELAY_MS},
       * rather than the moment it first reads empty.
       *
       * A selection can be momentarily empty in the middle of an interaction
       * the user experiences as continuous, and hiding on the first such report
       * makes the bubble blink. Any range arriving before the timer fires
       * cancels it, so the common case costs nothing.
       */
      function scheduleHide(): void {
        if (!visible || closeTimer !== null) return;
        closeTimer = setTimeout(() => {
          closeTimer = null;
          hide();
        }, closeDelayMs);
      }

      function reposition(view: EditorView): void {
        const anchor = measureAnchor(view);
        if (anchor) {
          // Placement clamps a stray anchor back inside the window rather than
          // dropping it, which is right for a bubble whose text is on screen and
          // wrong for one whose text is not: the selection scrolls out of the
          // note and the bubble parks against the window edge over the app's own
          // chrome, pointing at a line nobody can see. So the cull is decided
          // here, against the box the note actually scrolls in, before the
          // placement is asked. Never while the keyboard is in the toolbar,
          // which hides with `display: none` and would take focus with it.
          culled = !anchorInContainer(anchor, noteScroller(view)) && !holdsFocus();
          dom.root.toggleAttribute('data-hidden', culled);
          if (!culled) {
            const size = { width: dom.root.offsetWidth, height: dom.root.offsetHeight };
            const viewport = { width: window.innerWidth, height: window.innerHeight };
            const placement = placeToolbar(anchor, size, viewport);
            dom.root.style.top = `${String(placement.top)}px`;
            dom.root.style.left = `${String(placement.left)}px`;
            dom.root.classList.toggle(`${ROOT}-below`, !placement.showAbove);
          }
        }
        // Outside that, because the palette hangs off the toolbar rather than
        // off the text: it has to be placed again whenever the toolbar moves or
        // the window changes size under it, and it needs no anchor to do so.
        positionPopover();
      }

      function markSelected(el: HTMLButtonElement, selected: boolean): void {
        el.classList.toggle('is-selected', selected);
        el.setAttribute('aria-pressed', String(selected));
      }

      function updateActiveStates(view: EditorView): void {
        const { state } = view;
        for (const button of dom.buttons) {
          if (button.kind === 'link') {
            const active = isLinkActive(state);
            button.el.classList.toggle('is-active', active);
            button.el.setAttribute('aria-pressed', String(active));
            button.el.disabled = !canEditLink(state);
            continue;
          }
          const { el, command } = button;
          const active = command.isActive?.(state) ?? false;
          el.classList.toggle('is-active', active);
          if (command.isActive) el.setAttribute('aria-pressed', String(active));
          el.disabled = !isCommandEnabled(command, state);
        }

        const activeForeground = foreground?.activeToken(state) ?? null;
        for (const { el, cell } of dom.textCells) {
          markSelected(el, cell.token === activeForeground);
        }
        const activeBackground = background?.activeToken(state) ?? null;
        for (const { el, cell } of dom.backgroundCells) {
          markSelected(el, cell.token === activeBackground);
        }

        const swatch = TEXT_SWATCHES.find((cell) => cell.token === activeForeground);
        dom.colorPreview.style.color = swatch?.cssVar ? `var(${swatch.cssVar})` : '';
        dom.colorButton.disabled = !foreground || !isCommandEnabled(foreground, state);
        // Last, so the single tab stop lands on a control that is still
        // available after this pass decided which ones are.
        toolbarFocus.sync();
      }

      /**
       * The one place visibility is decided. `moved` is false when the document
       * changed under an unchanged selection: readouts still need recomputing
       * because the marks changed, but the anchor did not move, and measuring
       * on every keystroke is exactly the cost this editor avoids.
       */
      function sync(view: EditorView, moved: boolean): void {
        // Nothing happens mid-drag. The selection is still being drawn, so
        // showing now means a bubble that appears after one character and then
        // chases the pointer across the text being selected.
        if (selecting) return;
        if (dismissed) {
          hide();
          return;
        }
        if (view.state.selection.empty) {
          scheduleHide();
          return;
        }
        cancelScheduledClose();
        visible = true;
        dom.root.toggleAttribute('data-hidden', culled);
        updateActiveStates(view);
        if (moved) reposition(view);
      }

      // Buttons run their command against the live view, using the same
      // dry-run/dispatch split as every other command surface. The link
      // button has no command of its own to run; a click just toggles its
      // popover, anchored to the button that was pressed.
      for (const button of dom.buttons) {
        if (button.kind === 'link') {
          button.el.addEventListener('click', () => {
            linkPopover.toggle(button.el.getBoundingClientRect());
          });
          continue;
        }
        const { el, command } = button;
        el.addEventListener('click', () => {
          command.run(editorView.state, editorView.dispatch, editorView);
        });
      }

      dom.colorButton.addEventListener('click', () => {
        if (popoverOpen) closePopover();
        else openPopover();
      });

      if (foreground) {
        for (const { el, cell } of dom.textCells) {
          el.addEventListener('click', () => {
            const command = cell.token ? foreground.runWith(cell.token) : foreground.clear;
            command(editorView.state, editorView.dispatch, editorView);
            closePopover();
          });
        }
      }
      if (background) {
        for (const { el, cell } of dom.backgroundCells) {
          el.addEventListener('click', () => {
            const command = cell.token ? background.runWith(cell.token) : background.clear;
            command(editorView.state, editorView.dispatch, editorView);
            closePopover();
          });
        }
      }

      /**
       * One press dismisses one layer. A press outside an open colour popover
       * closes just that popover; only a press with no popover open reaches
       * the toolbar itself. The link flyout is its own layer above all of
       * this: a press inside it is left alone, and a press outside it while
       * it is open closes only the flyout, the same one-layer-per-press rule.
       */
      function onDocumentMouseDown(event: MouseEvent): void {
        const target = event.target as Node | null;
        if (!target) return;
        if (linkPopover.contains(target)) return;
        if (editorView.dom.contains(target)) {
          // A press in the document is the start of a selection gesture, even
          // if it turns out to be a plain click. Whatever the toolbar was
          // pointing at is about to stop being the selection, so it goes away
          // now and comes back once the gesture finishes.
          selecting = true;
          hide();
          return;
        }
        // The colour button owns its own toggle; let its click handler answer.
        if (dom.colorButton.contains(target)) return;
        if (popoverOpen) {
          if (dom.popover.contains(target)) return;
          closePopover();
          return;
        }
        if (dom.root.contains(target)) return;
        // A genuinely external press: it is already claiming focus for
        // itself, so the flyout is dismissed without fighting that press's
        // own destination (`close` restores the selection but does not
        // refocus the editor).
        if (linkPopover.isOpen()) linkPopover.close();
        dismissed = true;
        // Stood down before hiding, because at mousedown the press has not
        // taken focus yet: leaving the scope alive would let `hide` pull focus
        // into the editor behind whatever the user just clicked.
        focusScope?.release();
        focusScope = null;
        hide();
      }
      document.addEventListener('mousedown', onDocumentMouseDown, true);

      function onDocumentMouseUp(): void {
        if (!selecting) return;
        selecting = false;
        sync(editorView, true);
      }
      document.addEventListener('mouseup', onDocumentMouseUp, true);

      /**
       * One press stands down one layer, the same rule the mouse follows: with
       * the palette open Escape closes just the palette, and only then does it
       * reach the toolbar and give the caret back.
       */
      function onToolbarKeyDown(event: KeyboardEvent): void {
        if (event.defaultPrevented) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          if (popoverOpen) closePopover();
          else returnFocusToEditor();
          return;
        }
        const inPalette = popoverOpen && dom.popover.contains(event.target as Node | null);
        const group = inPalette ? paletteFocus : toolbarFocus;
        if (group.handleKey(event)) event.preventDefault();
      }
      dom.root.addEventListener('keydown', onToolbarKeyDown);

      /**
       * Focus left by a route the toolbar does not own, a Tab or a click
       * somewhere else. The selection is wherever that route put it, so the
       * scope stands down instead of dragging it back.
       */
      function onToolbarFocusOut(event: FocusEvent): void {
        const next = event.relatedTarget as Node | null;
        if (next && dom.root.contains(next)) return;
        focusScope?.release();
        focusScope = null;
      }
      dom.root.addEventListener('focusout', onToolbarFocusOut);

      function onViewportChange(): void {
        if (visible) reposition(editorView);
      }
      window.addEventListener('scroll', onViewportChange, true);
      window.addEventListener('resize', onViewportChange);

      focusEntries.set(editorView, focusToolbar);
      sync(editorView, true);

      return {
        update(view, prevState): void {
          const selectionChanged = !view.state.selection.eq(prevState.selection);
          const docChanged = !view.state.doc.eq(prevState.doc);
          if (!selectionChanged && !docChanged) return;
          // Deliberately set, not merely remapped by an edit somewhere before
          // it. Only the first is the user engaging with the document again,
          // and only that retires an earlier dismissal: typing must not put
          // back a bubble the user has already waved away.
          const moved =
            (selectionSetCounter.getState(view.state) ?? 0) >
            (selectionSetCounter.getState(prevState) ?? 0);
          if (moved) dismissed = false;
          sync(view, moved);
        },
        destroy(): void {
          cancelScheduledClose();
          window.removeEventListener('scroll', onViewportChange, true);
          window.removeEventListener('resize', onViewportChange);
          document.removeEventListener('mousedown', onDocumentMouseDown, true);
          document.removeEventListener('mouseup', onDocumentMouseUp, true);
          focusEntries.delete(editorView);
          linkEntries.delete(editorView);
          linkPopover.destroy();
          // Never restored: the view is going away, and there is no document
          // left to put a selection back into.
          focusScope?.release();
          focusScope = null;
          dom.root.remove();
        },
      };
    },
    props: {
      handleKeyDown(view, event) {
        if (event.key === FOCUS_CHORD && event.altKey) {
          return focusEntries.get(view)?.() ?? false;
        }
        if (isLinkChord(event)) {
          // A bare caret has `from === to`, and `measureAnchor` handles that
          // the same as any other selection; the fallback is only for the
          // environments it already returns null for.
          const anchor = measureAnchor(view) ?? { top: 0, bottom: 0, left: 0, right: 0 };
          return linkEntries.get(view)?.open(anchor) ?? false;
        }
        return false;
      },
    },
  });
}
