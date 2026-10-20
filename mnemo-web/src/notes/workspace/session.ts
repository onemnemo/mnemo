/**
 * What the notes workspace remembers between visits: the open note, the collapsed
 * folders and the expanded notes.
 *
 * localStorage rather than a stored setting, for the same reason the router keeps
 * the last route there. Both are written every time the user clicks a different
 * note or folder, and a round trip per click to remember something only this
 * machine's next visit cares about is not a trade worth making. Nothing breaks
 * when the store refuses: the workspace opens on the empty state with every
 * folder expanded, which is where it started before it remembered anything.
 */

const LAST_NOTE_KEY = 'mnemo.notes.last-note';
const COLLAPSED_FOLDERS_KEY = 'mnemo.notes.collapsed-folders';
const EXPANDED_NOTES_KEY = 'mnemo.notes.expanded-notes';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // A full or blocked store costs the user the memory, not the note.
  }
}

/** The note this window was last on, or null. Never trusted to still exist. */
export function readLastNoteId(): string | null {
  const raw = read(LAST_NOTE_KEY);
  return raw && raw.length > 0 ? raw : null;
}

/** Remembers the open note; null forgets it, which is what closing it means. */
export function rememberLastNoteId(id: string | null): void {
  write(LAST_NOTE_KEY, id && id.length > 0 ? id : null);
}

function readIds(key: string): ReadonlySet<string> {
  const raw = read(key);
  if (!raw) return new Set();

  try {
    const parsed: unknown = JSON.parse(raw);
    // Anything else means the key was written by something other than this
    // module, so treat it as absent rather than trusting it.
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === 'string' && value.length > 0));
  } catch {
    return new Set();
  }
}

function writeIds(key: string, ids: ReadonlySet<string>): void {
  if (ids.size === 0) {
    write(key, null);
    return;
  }
  // Sorted so the stored value only changes when the set does, which keeps a
  // rewrite of the same state from looking like a new one.
  write(key, JSON.stringify([...ids].sort()));
}

/**
 * The ids that are still in `liveIds`. The same set comes back when nothing is
 * stale, so the caller can skip a state update.
 */
function keepLive(ids: ReadonlySet<string>, liveIds: Iterable<string>): ReadonlySet<string> {
  const live = new Set(liveIds);
  const next = new Set<string>();
  for (const id of ids) if (live.has(id)) next.add(id);
  return next.size === ids.size ? ids : next;
}

/** The collapsed folder ids. Storing collapsed ones lets a new folder start open. */
export function readCollapsedFolders(): ReadonlySet<string> {
  return readIds(COLLAPSED_FOLDERS_KEY);
}

export function rememberCollapsedFolders(ids: ReadonlySet<string>): void {
  writeIds(COLLAPSED_FOLDERS_KEY, ids);
}

/** The collapsed set without folders that no longer exist. */
export function pruneCollapsedFolders(
  collapsed: ReadonlySet<string>,
  folderIds: Iterable<string>,
): ReadonlySet<string> {
  return keepLive(collapsed, folderIds);
}

/**
 * The notes whose children were left showing. Storing expanded ones means a lost key
 * folds everything instead of opening thousands of notes.
 */
export function readExpandedNotes(): ReadonlySet<string> {
  return readIds(EXPANDED_NOTES_KEY);
}

export function rememberExpandedNotes(ids: ReadonlySet<string>): void {
  writeIds(EXPANDED_NOTES_KEY, ids);
}

/** The expanded set without notes that no longer exist. */
export function pruneExpandedNotes(
  expanded: ReadonlySet<string>,
  noteIds: Iterable<string>,
): ReadonlySet<string> {
  return keepLive(expanded, noteIds);
}
