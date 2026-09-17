/**
 * The symbol palette: type `\` at a word boundary and pick a character by its
 * LaTeX name.
 *
 * Modelled on the emoji picker's `:` rather than on the slash menu: the
 * trigger works mid-line, the query lives in the document, and a pick
 * replaces only its own token, as its own undo step, with the character it
 * names. Escape leaves the typed text where it is, and so does a space after
 * a name nothing matches, because someone writing about LaTeX types `\frac`
 * all day and must not be fought over it. A query nothing matches only hides
 * the list rather than ending the trigger, so a corrected typo brings it
 * straight back.
 *
 * Recents sit at the top while the query is empty, stored per machine the way
 * the emoji picker's are.
 */

import { PluginKey } from 'prosemirror-state';
import { asOwnUndoStep } from '../history';
import { useI18nStore } from '../../../i18n/store';
import { createTranslate } from '../../../i18n/translate';
import { caretMenuPlugin, type CaretTrigger, type MenuRow, type TokenReader } from '../slash';
import { SYMBOL_GROUP_LABEL_KEY, type SymbolEntry } from './catalog';
import { readRecentSymbols, rememberSymbol } from './recent';
import { searchSymbols } from './search';

export const symbolPaletteKey = new PluginKey<CaretTrigger | null>('mnemo-symbol-palette');

/** A LaTeX name never holds a space, so a space is the end of the token. */
const BACKSLASH_READER: TokenReader = { trigger: '\\', spaces: false };

export interface SymbolPaletteOptions {
  /** Injected so a test asserts on stable keys, not on the shipped bundle. */
  readonly translate?: (key: string) => string;
}

interface SymbolRow extends MenuRow {
  readonly entry: SymbolEntry;
}

/** Reads the active bundle at call time, so it follows a language change. */
function defaultTranslate(key: string): string {
  return createTranslate(useI18nStore.getState().bundle)('NotesEditor', key);
}

function rowsFor(query: string): readonly SymbolRow[] {
  return searchSymbols(query, { recents: readRecentSymbols() }).map(({ entry, group }) => ({
    entry,
    key: entry.name,
    group: SYMBOL_GROUP_LABEL_KEY[group],
    tile: { glyph: entry.char },
    label: `\\${entry.name}`,
    description: '',
  }));
}

export function symbolPalettePlugin(options: SymbolPaletteOptions = {}) {
  return caretMenuPlugin<SymbolRow>({
    key: symbolPaletteKey,
    reader: BACKSLASH_READER,
    translate: options.translate ?? defaultTranslate,
    listLabel: 'SymbolPaletteLabel',
    rows: rowsFor,
    pick: (view, row, token) => {
      // Replacing the range rather than inserting at the caret keeps the
      // marks the token was typed with, so a bold `\alpha` gives a bold α.
      view.dispatch(asOwnUndoStep(view.state.tr.insertText(row.entry.char, token.from, token.to)));
      rememberSymbol(row.entry.name);
    },
    dismissOnNoMatch: false,
    picksOnBareTrigger: false,
  });
}
