/**
 * The slash menu: type `/` at a word boundary and pick what the block becomes.
 *
 * Rows come from the block registry, so a block type offers itself and the
 * menu has no list of its own to drift from. Their order is the registry's,
 * which already reads Text, headings, lists, quote, then the inserts.
 *
 * A pick takes the typed `/query` out of the line before the row runs, so the
 * row sees the line as content alone and only ever converts or places a block
 * around what the user wrote: a query at the start of an empty line leaves
 * nothing behind and the block simply changes type, as on the desktop, while
 * a query typed after a sentence leaves the sentence where it was. The row's
 * own step is then composed onto that deletion, so one press of undo gives
 * the typed query back along with the block type.
 */

import { EditorState, PluginKey, Selection, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { BlockRegistry, SlashEntry } from '../registry/build';
import type { EditorServices, SlashGroup, SlashInsertContext } from '../registry/types';
import { asOwnUndoStep } from '../history';
import { useI18nStore } from '../../../i18n/store';
import { createTranslate } from '../../../i18n/translate';
import { caretMenuPlugin, type CaretTrigger } from './caret-menu';
import { readToken, type TokenReader, type TriggerToken } from './caret-token';
import type { MenuRow } from './menu-view';
import { matchesQuery, searchCandidates } from './search';

export const slashMenuKey = new PluginKey<CaretTrigger | null>('mnemo-slash-menu');

/** A query may hold a space: `/heading 3` is how the level is reached. */
const SLASH_READER: TokenReader = { trigger: '/', spaces: true };

/** Section heading text, resolved from the group the entry declares. */
const GROUP_LABEL_KEY: Readonly<Record<SlashGroup, string>> = {
  text: 'SlashGroupBasic',
  insert: 'SlashGroupInsert',
};

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

interface SlashRow extends MenuRow {
  readonly entry: SlashEntry;
  readonly candidates: readonly string[];
}

/** Reads the active bundle at call time, so it follows a language change. */
function defaultTranslate(key: string): string {
  return createTranslate(useI18nStore.getState().bundle)('NotesEditor', key);
}

function buildRows(entries: readonly SlashEntry[], translate: (key: string) => string): readonly SlashRow[] {
  return entries.map((entry) => {
    const label = translate(entry.label);
    const description = translate(entry.description);
    return {
      entry,
      key: entry.label,
      group: GROUP_LABEL_KEY[entry.group],
      tile: { icon: entry.icon },
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

/**
 * A state holding the document as `staged` leaves it, for a row to build its
 * step against. Plugin-free on purpose: applying the staged transaction
 * through the real state would run every plugin's append hook and could add
 * steps the row's transaction then no longer lines up with.
 */
function detached(staged: Transaction): EditorState {
  return EditorState.create({ doc: staged.doc, selection: staged.selection });
}

/** Appends `next`'s steps and selection to `base`, whose document `next` was built on. */
function compose(base: Transaction, next: Transaction): Transaction {
  for (const step of next.steps) base.step(step);
  base.setSelection(Selection.fromJSON(base.doc, next.selection.toJSON()));
  return base.scrollIntoView();
}

function pickRow(
  view: EditorView,
  row: SlashRow,
  token: TriggerToken,
  services: EditorServices | undefined,
): void {
  let staged: Transaction | null = view.state.tr.delete(token.from, token.to);

  const dispatch = (tr: Transaction): void => {
    // One pick is one undo step, so a single press takes the block type back
    // and leaves the typed query there to be corrected.
    const whole = staged && tr.before.eq(staged.doc) ? compose(staged, tr) : tr;
    staged = null;
    view.dispatch(asOwnUndoStep(whole));
  };

  const context: SlashInsertContext | undefined = services
    ? {
        services,
        // A row that awaits something builds its step against the document as
        // it is when it returns. The query is taken out of that document, not
        // the one the row was picked in, provided the caret is still on it.
        currentState: () => {
          const trigger = slashMenuKey.getState(view.state);
          const live = trigger ? readToken(view.state, SLASH_READER, trigger.pos) : null;
          staged = live ? view.state.tr.delete(live.from, live.to) : null;
          return staged ? detached(staged) : view.state;
        },
      }
    : undefined;

  void row.entry.insert(detached(staged), dispatch, context);
}

export function slashMenuPlugin(registry: BlockRegistry, options: SlashMenuOptions = {}) {
  const translate = options.translate ?? defaultTranslate;
  const allRows = buildRows(registry.slash, translate);

  return caretMenuPlugin<SlashRow>({
    key: slashMenuKey,
    reader: SLASH_READER,
    translate,
    listLabel: 'SlashMenuLabel',
    rows: (query) => allRows.filter((row) => matchesQuery(row.candidates, query)),
    pick: (view, row, token) => {
      pickRow(view, row, token, options.services);
    },
    // A query nothing can match is not a command any more, it is a path, a
    // date or a route the user is writing. The menu stands down and the
    // trigger with it, so Enter, the arrows, Home and End go back to the
    // editor instead of being swallowed by a list with nothing in it.
    dismissOnNoMatch: true,
    picksOnBareTrigger: true,
  });
}
