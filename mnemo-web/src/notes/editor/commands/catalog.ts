/**
 * The editor command catalog — one contract per command the Notes editor offers.
 *
 * Every surface that can run a command reads it from here: the editor keymap
 * (`keymap.ts`), the formatting toolbar (M11) and the slash menu (M13). Without a
 * single catalog each surface reinvents the id, label, icon, shortcut and the
 * "is it available / is it on" logic, and they drift — the Avalonia editor had
 * exactly that drift, with a toolbar readout that could disagree with what a
 * click did. Here a command is described once and the surfaces are projections.
 *
 * The commands themselves live in `marks/` and `atoms/`; this only names them,
 * gives each a stable id and default shortcut, and wires availability/active
 * readouts to the *same* helpers the commands apply through, so a button's
 * highlight and its click can never diverge.
 *
 * Ids mirror the desktop action ids (`editor.bold`, …) so a future user-override
 * keybind path can address the same command by the same name across engines.
 */

import type { Command, EditorState } from 'prosemirror-state';
import type { IconName } from '../../../components/icon/icon-registry';
import {
  activeSwatchToken,
  clearStoredMarks,
  isFormatActive,
  toggleFormat,
} from '../marks/commands';
import { insertEquation } from '../atoms/commands';
import { redo, undo } from '../history';

/** Toolbar sectioning and slash-menu grouping. */
export type CommandGroup = 'history' | 'inline-format' | 'script' | 'color' | 'insert' | 'escape';

interface CommandMeta {
  /** Stable id, shared with the desktop action id where one exists. */
  readonly id: string;
  /** i18n key for the visible label; resolves to the key on a miss. */
  readonly titleKey: string;
  readonly icon?: IconName;
  readonly group: CommandGroup;
  /** Default editor-scoped keybinding in prosemirror-keymap syntax, e.g. "Mod-b". */
  readonly shortcut?: string;
  /**
   * Further chords that run the same command but are not the one shown in the UI.
   * Redo is the case that needs it: Windows learned Ctrl+Y and macOS learned
   * Cmd+Shift+Z, and a user who knows one of them is not helped by being told the
   * other is the real name for it.
   */
  readonly aliases?: readonly string[];
}

/** A command with a fixed behaviour — the common case. */
export interface DirectCommand extends CommandMeta {
  readonly kind: 'direct';
  readonly run: Command;
  /**
   * Toolbar highlight state. Omitted where "active" is meaningless — inserting an
   * equation is never "on". Present readouts share the applier's helpers.
   */
  readonly isActive?: (state: EditorState) => boolean;
}

/**
 * A command parameterised by a design token — the colour swatches. It cannot be
 * a single `Command` because the token is chosen at click time, so it exposes a
 * factory plus a token readout instead of a fixed `run`/`isActive`.
 */
export interface SwatchCommand extends CommandMeta {
  readonly kind: 'swatch';
  readonly family: 'backgroundColor' | 'foregroundColor';
  readonly runWith: (token: string) => Command;
  /** The token in force across the selection, or null if none/mixed. */
  readonly activeToken: (state: EditorState) => string | null;
}

export type EditorCommand = DirectCommand | SwatchCommand;

function flag(
  id: string,
  kind: Parameters<typeof toggleFormat>[0],
  icon: IconName | undefined,
  group: CommandGroup,
  shortcut?: string,
): DirectCommand {
  return {
    kind: 'direct',
    id,
    titleKey: `notes.command.${id.replace(/^editor\./, '')}`,
    icon,
    group,
    shortcut,
    run: toggleFormat(kind),
    isActive: (state) => isFormatActive(state, kind),
  };
}

function swatch(
  id: string,
  family: SwatchCommand['family'],
  icon: IconName | undefined,
): SwatchCommand {
  const kind = family;
  return {
    kind: 'swatch',
    id,
    titleKey: `notes.command.${id.replace(/^editor\./, '')}`,
    icon,
    group: 'color',
    family,
    runWith: (token) => toggleFormat(kind, token),
    activeToken: (state) => activeSwatchToken(state, kind),
  };
}

/**
 * The catalog. Ordered as the toolbar reads it left to right; the keymap and
 * slash menu take their own subsets. Shortcuts match the desktop chords
 * (`CoreUIModule.Chords`, and Ctrl+Z / Ctrl+Y for history); `code`, the swatches
 * and the equation carry none there and carry none here. Sub/sup use Primary+`,`
 * and `.` — `OemComma`/`OemPeriod`.
 */
export const EDITOR_COMMANDS: readonly EditorCommand[] = [
  {
    kind: 'direct',
    id: 'editor.undo',
    titleKey: 'notes.command.undo',
    group: 'history',
    shortcut: 'Mod-z',
    run: undo,
    // Nothing to highlight — but `isCommandEnabled` dry-runs `undo`, which
    // answers "is there anything on the stack", so a toolbar button disables
    // itself on an empty history without a second predicate to keep in step.
  },
  {
    kind: 'direct',
    id: 'editor.redo',
    titleKey: 'notes.command.redo',
    group: 'history',
    shortcut: 'Mod-y',
    aliases: ['Mod-Shift-z'],
    run: redo,
  },
  flag('editor.bold', 'bold', 'formatting-toolbar/bold', 'inline-format', 'Mod-b'),
  flag('editor.italic', 'italic', 'formatting-toolbar/italic', 'inline-format', 'Mod-i'),
  flag('editor.underline', 'underline', 'formatting-toolbar/underline', 'inline-format', 'Mod-u'),
  flag(
    'editor.strikethrough',
    'strikethrough',
    'formatting-toolbar/strikethrough',
    'inline-format',
    'Mod-Shift-s',
  ),
  flag('editor.highlight', 'highlight', 'formatting-toolbar/highlighter', 'inline-format', 'Mod-Shift-h'),
  flag('editor.code', 'code', undefined, 'inline-format'),
  swatch('editor.color.background', 'backgroundColor', undefined),
  swatch('editor.color.foreground', 'foregroundColor', undefined),
  flag('editor.subscript', 'subscript', 'formatting-toolbar/subscript', 'script', 'Mod-,'),
  flag('editor.superscript', 'superscript', 'formatting-toolbar/superscript', 'script', 'Mod-.'),
  {
    kind: 'direct',
    id: 'editor.equation',
    titleKey: 'notes.command.equation',
    group: 'insert',
    run: insertEquation(),
    // "active" is meaningless for an insert, so no readout.
  },
  {
    kind: 'direct',
    id: 'editor.clearMarks',
    titleKey: 'notes.command.clearMarks',
    icon: 'formatting-toolbar/ban',
    group: 'escape',
    run: clearStoredMarks,
    // A momentary escape, not a sticky state — nothing to highlight.
  },
];

/** The catalog indexed by id, for surfaces that address a command by name. */
export const COMMANDS_BY_ID: ReadonlyMap<string, EditorCommand> = new Map(
  EDITOR_COMMANDS.map((command) => [command.id, command]),
);

/**
 * Whether a direct command would do anything right now — the availability the
 * toolbar disables by and the keymap falls through on. A ProseMirror command
 * dry-runs when called without a dispatch, returning whether it applies, so
 * availability needs no separate predicate and cannot drift from execution. A
 * swatch's availability depends only on where the caret is, not which token, so
 * any token answers; the empty string would trip the command's own "no token"
 * guard, so a probe token is used purely to ask "could a colour apply here".
 */
export function isCommandEnabled(command: EditorCommand, state: EditorState): boolean {
  if (command.kind === 'direct') return command.run(state);
  return command.runWith('__probe__')(state);
}
