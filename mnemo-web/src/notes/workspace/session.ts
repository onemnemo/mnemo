/**
 * What the notes workspace remembers between visits: the note that was open, and
 * the folders that were twirled shut.
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

/**
 * The folder ids that were collapsed. Collapsed rather than expanded ids, so a
 * folder created since the last visit opens rather than hiding what is in it.
 */
export function readCollapsedFolders(): ReadonlySet<string> {
  const raw = read(COLLAPSED_FOLDERS_KEY);
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

export function rememberCollapsedFolders(ids: ReadonlySet<string>): void {
  if (ids.size === 0) {
    write(COLLAPSED_FOLDERS_KEY, null);
    return;
  }
  // Sorted so the stored value only changes when the set does, which keeps a
  // rewrite of the same state from looking like a new one.
  write(COLLAPSED_FOLDERS_KEY, JSON.stringify([...ids].sort()));
}

/**
 * The collapsed set with ids that no longer name a folder dropped, or the set
 * itself when nothing is stale. Returning the original identity lets the caller
 * skip a state update, so a tree that never changes never re-renders.
 */
export function pruneCollapsedFolders(
  collapsed: ReadonlySet<string>,
  folderIds: Iterable<string>,
): ReadonlySet<string> {
  const known = new Set(folderIds);
  const next = new Set<string>();
  for (const id of collapsed) if (known.has(id)) next.add(id);
  return next.size === collapsed.size ? collapsed : next;
}
