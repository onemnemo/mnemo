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
import { getIconMarkup } from '../../../components/icon/icon-registry';
import { useI18nStore } from '../../../i18n/store';
import { createTranslate } from '../../../i18n/translate';
import { BACKGROUND_SWATCHES, TEXT_SWATCHES, type SwatchCell } from './palette';
import { placeToolbar, type Rect } from '../floating/position';

const ROOT = 'notes-formatting-toolbar';

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
  'editor.highlight': 'HighlightTooltip',
  'editor.subscript': 'SubscriptTooltip',
  'editor.superscript': 'SuperscriptTooltip',
  'editor.equation': 'EquationTooltip',
};

/**
 * The buttons shown, in order, and the divider groups around them, matching
 * the desktop toolbar. Link belongs with the link-editing surface, and code,
 * clear-marks and undo/redo belong to the slash menu and keymap.
 */
const BUTTON_GROUPS: readonly (readonly string[])[] = [
  ['editor.bold', 'editor.italic', 'editor.underline', 'editor.strikethrough', 'editor.highlight'],
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

interface ToolbarButton {
  readonly el: HTMLButtonElement;
  readonly command: DirectCommand;
}

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
): { readonly row: HTMLElement; readonly cellButtons: readonly SwatchCellButton[] } {
  const row = document.createElement('div');
  row.className = `${ROOT}-swatch-row`;
  const cellButtons = cells.map((cell): SwatchCellButton => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `${ROOT}-swatch-cell`;
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
  // Keeps focus, and with it the selection, from leaving the editor when a
  // control here is pressed. One guard at the root covers every control.
  root.addEventListener('mousedown', (event) => event.preventDefault());

  const colorButton = document.createElement('button');
  colorButton.type = 'button';
  colorButton.className = `${ROOT}-color`;
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
      const command = commandsById.get(id);
      if (!command || command.kind !== 'direct') continue;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `${ROOT}-btn`;
      el.dataset.command = id;
      const tooltipKey = TOOLTIP_KEYS[id];
      if (tooltipKey) el.title = translate(tooltipKey);
      if (id === 'editor.equation') {
        el.classList.add(`${ROOT}-btn-glyph`);
        el.textContent = 'Σ';
      } else {
        el.appendChild(iconSpan(command.icon));
      }
      root.appendChild(el);
      buttons.push({ el, command });
    }
    if (index < BUTTON_GROUPS.length - 1) root.appendChild(divider());
  });

  const popover = document.createElement('div');
  popover.className = `${ROOT}-swatch-popover`;
  popover.setAttribute('data-hidden', '');

  const textHeader = document.createElement('div');
  textHeader.className = `${ROOT}-swatch-header`;
  textHeader.textContent = translate('TextColor');
  const backgroundHeader = document.createElement('div');
  backgroundHeader.className = `${ROOT}-swatch-header`;
  backgroundHeader.textContent = translate('BackgroundColor');

  // Clicks are wired in by the plugin, which is what holds the live view.
  const text = buildSwatchRow(TEXT_SWATCHES, 'text', translate);
  const background = buildSwatchRow(BACKGROUND_SWATCHES, 'background', translate);
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

/** The plugin to include in a note's editable `EditorState` plugins. */
export function formattingToolbarPlugin(options: FormattingToolbarOptions = {}): Plugin {
  const commands = options.commands ?? EDITOR_COMMANDS;
  const commandsById = new Map(commands.map((command) => [command.id, command] as const));
  const foreground = commandsById.get('editor.color.foreground') as SwatchCommand | undefined;
  const background = commandsById.get('editor.color.background') as SwatchCommand | undefined;
  const translate = options.translate ?? defaultTranslate;
  const closeDelayMs = options.closeDelayMs ?? CLOSE_DELAY_MS;

  return new Plugin({
    state: {
      init: () => 0,
      apply: (tr, count) => (tr.selectionSet ? count + 1 : count),
    },
    key: selectionSetCounter,
    view(editorView) {
      const dom = buildToolbarDom(commandsById, translate);
      document.body.appendChild(dom.root);

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

      function cancelScheduledClose(): void {
        if (closeTimer === null) return;
        clearTimeout(closeTimer);
        closeTimer = null;
      }

      function closePopover(): void {
        if (!popoverOpen) return;
        popoverOpen = false;
        dom.popover.setAttribute('data-hidden', '');
      }

      function openPopover(): void {
        if (popoverOpen) return;
        popoverOpen = true;
        dom.popover.removeAttribute('data-hidden');
      }

      function hide(): void {
        cancelScheduledClose();
        if (!visible) return;
        visible = false;
        dom.root.setAttribute('data-hidden', '');
        closePopover();
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
        if (!anchor) return;
        const size = { width: dom.root.offsetWidth, height: dom.root.offsetHeight };
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        const placement = placeToolbar(anchor, size, viewport);
        dom.root.style.top = `${String(placement.top)}px`;
        dom.root.style.left = `${String(placement.left)}px`;
        dom.root.classList.toggle(`${ROOT}-below`, !placement.showAbove);
      }

      function updateActiveStates(view: EditorView): void {
        const { state } = view;
        for (const { el, command } of dom.buttons) {
          el.classList.toggle('is-active', command.isActive?.(state) ?? false);
          el.disabled = !isCommandEnabled(command, state);
        }

        const activeForeground = foreground?.activeToken(state) ?? null;
        for (const { el, cell } of dom.textCells) {
          el.classList.toggle('is-selected', cell.token === activeForeground);
        }
        const activeBackground = background?.activeToken(state) ?? null;
        for (const { el, cell } of dom.backgroundCells) {
          el.classList.toggle('is-selected', cell.token === activeBackground);
        }

        const swatch = TEXT_SWATCHES.find((cell) => cell.token === activeForeground);
        dom.colorPreview.style.color = swatch?.cssVar ? `var(${swatch.cssVar})` : '';
        dom.colorButton.disabled = !foreground || !isCommandEnabled(foreground, state);
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
        dom.root.removeAttribute('data-hidden');
        updateActiveStates(view);
        if (moved) reposition(view);
      }

      // Buttons run their command against the live view, using the same
      // dry-run/dispatch split as every other command surface.
      for (const { el, command } of dom.buttons) {
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
       * the toolbar itself.
       */
      function onDocumentMouseDown(event: MouseEvent): void {
        const target = event.target as Node | null;
        if (!target) return;
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
        dismissed = true;
        hide();
      }
      document.addEventListener('mousedown', onDocumentMouseDown, true);

      function onDocumentMouseUp(): void {
        if (!selecting) return;
        selecting = false;
        sync(editorView, true);
      }
      document.addEventListener('mouseup', onDocumentMouseUp, true);

      function onViewportChange(): void {
        if (visible) reposition(editorView);
      }
      window.addEventListener('scroll', onViewportChange, true);
      window.addEventListener('resize', onViewportChange);

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
          dom.root.remove();
        },
      };
    },
  });
}
