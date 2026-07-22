/**
 * Roving tabindex for the editor's floating chrome.
 *
 * A toolbar is one tab stop, not one per control: something reaches it once and
 * the arrow keys move inside it. That means exactly one control carries
 * `tabindex="0"` at a time and the rest carry `-1`, which is bookkeeping every
 * such surface needs and none of them should be writing itself.
 *
 * Rows are read through a callback rather than captured, because which controls
 * a surface offers changes with the selection: a captured array goes stale the
 * first time a command disables its button.
 *
 * One shape covers both users. A toolbar is a single row, so its vertical keys
 * find nothing to do; the colour palette is two rows, and its vertical keys walk
 * between them keeping the column.
 */

/** A control a group can hold. Both surfaces draw buttons, and `disabled` is read. */
type RovingItem = HTMLButtonElement;

export interface RovingFocus {
  /**
   * Puts the tab stop back on a reachable control. Called whenever availability
   * changes, so the group's single entry point is never a disabled button.
   */
  sync(): void;
  /** Moves DOM focus into the group. False when nothing in it is reachable. */
  focus(): boolean;
  /** Sends the entry point back to the start, for the next time the group opens. */
  reset(): void;
  /** Handles an arrow/Home/End press, returning whether it was consumed. */
  handleKey(event: KeyboardEvent): boolean;
}

type Rows = () => readonly (readonly RovingItem[])[];

/** A control the command catalog refuses is skipped, never focused. */
function isAvailable(item: RovingItem): boolean {
  return !item.disabled;
}

/** The available index at or nearest to `start`, searching outward. -1 if none. */
function nearest(line: readonly RovingItem[], start: number): number {
  for (let step = 0; step < line.length; step++) {
    const after = start + step;
    if (after < line.length && isAvailable(line[after])) return after;
    const before = start - step;
    if (before >= 0 && isAvailable(line[before])) return before;
  }
  return -1;
}

export function createRovingFocus(rows: Rows): RovingFocus {
  let row = 0;
  let col = 0;

  /** Empty rows are dropped so an unpopulated group cannot become a dead stop. */
  function grid(): readonly (readonly RovingItem[])[] {
    return rows().filter((line) => line.length > 0);
  }

  function applyTabStops(g: readonly (readonly RovingItem[])[]): void {
    g.forEach((line, r) => {
      line.forEach((item, c) => {
        item.tabIndex = r === row && c === col ? 0 : -1;
      });
    });
  }

  /** Settles the entry point on a reachable control, preferring where it is. */
  function settle(g: readonly (readonly RovingItem[])[]): boolean {
    if (g.length === 0) return false;
    row = Math.min(row, g.length - 1);
    col = Math.min(col, g[row].length - 1);

    for (let step = 0; step < g.length; step++) {
      const r = (row + step) % g.length;
      const found = nearest(g[r], step === 0 ? col : 0);
      if (found >= 0) {
        row = r;
        col = found;
        return true;
      }
    }
    return false;
  }

  function move(nextRow: number, nextCol: number, g: readonly (readonly RovingItem[])[]): boolean {
    row = nextRow;
    col = nextCol;
    applyTabStops(g);
    g[row][col].focus();
    return true;
  }

  /** Steps along the current row, wrapping: a short ring of controls reads as
   * stuck rather than bounded when the ends refuse to carry on. */
  function stepAcross(delta: number): boolean {
    const g = grid();
    const line = g[row] as readonly RovingItem[] | undefined;
    if (!line) return false;
    for (let step = 1; step <= line.length; step++) {
      const next = (((col + delta * step) % line.length) + line.length) % line.length;
      if (isAvailable(line[next])) return move(row, next, g);
    }
    return false;
  }

  /** Steps between rows, keeping the column where the next row is long enough. */
  function stepDown(delta: number): boolean {
    const g = grid();
    if (g.length < 2) return false;
    for (let step = 1; step <= g.length; step++) {
      const r = (((row + delta * step) % g.length) + g.length) % g.length;
      const line = g[r];
      const found = nearest(line, Math.min(col, line.length - 1));
      if (found >= 0) return move(r, found, g);
    }
    return false;
  }

  /** Home and End reach the ends of the current row in one press. */
  function stepToEnd(end: 'first' | 'last'): boolean {
    const g = grid();
    const line = g[row] as readonly RovingItem[] | undefined;
    if (!line) return false;
    const found = nearest(line, end === 'first' ? 0 : line.length - 1);
    return found >= 0 ? move(row, found, g) : false;
  }

  return {
    sync(): void {
      const g = grid();
      if (settle(g)) applyTabStops(g);
    },

    focus(): boolean {
      const g = grid();
      if (!settle(g)) return false;
      applyTabStops(g);
      g[row][col].focus();
      return true;
    },

    reset(): void {
      row = 0;
      col = 0;
      const g = grid();
      if (settle(g)) applyTabStops(g);
    },

    handleKey(event): boolean {
      // A chord belongs to whoever bound it. Only the bare navigation keys move
      // the tab stop, so Ctrl+Home still means what it means everywhere else.
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
      switch (event.key) {
        case 'ArrowRight':
          return stepAcross(1);
        case 'ArrowLeft':
          return stepAcross(-1);
        case 'ArrowDown':
          return stepDown(1);
        case 'ArrowUp':
          return stepDown(-1);
        case 'Home':
          return stepToEnd('first');
        case 'End':
          return stepToEnd('last');
        default:
          return false;
      }
    },
  };
}
