/**
 * A tiny external store the paste path drives and the overlay reads.
 *
 * The staging overlay must render outside the editor's DOM: a node inside
 * `view.dom` looks to ProseMirror's own MutationObserver like an external edit
 * and triggers defensive NodeView rebuilds. So the paste plugin, which lives
 * below React, cannot render the overlay itself; it writes progress here and the
 * React overlay, mounted in the surface and portalled to the body, reads it.
 *
 * One paste stages at a time, so a single shared slot is enough; a second paste
 * would simply overwrite it, which is the correct last-writer-wins behaviour for
 * a modal progress indicator.
 */

export interface PasteProgressSnapshot {
  readonly active: boolean;
  readonly total: number;
  readonly done: number;
  /** Cancels the in-flight staging; null once there is nothing to cancel. */
  readonly onCancel: (() => void) | null;
}

/** What the paste path calls to drive the overlay, injected so a path can opt out. */
export interface PasteProgressReporter {
  begin(total: number, onCancel: () => void): void;
  advance(done: number): void;
  end(): void;
}

const idle: PasteProgressSnapshot = { active: false, total: 0, done: 0, onCancel: null };
let snapshot: PasteProgressSnapshot = idle;
const listeners = new Set<() => void>();

function emit(next: PasteProgressSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function subscribePasteProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Stable between emits, so `useSyncExternalStore` never loops on it. */
export function pasteProgressSnapshot(): PasteProgressSnapshot {
  return snapshot;
}

/** The reporter the real paste path uses; the overlay renders whatever it writes. */
export const storePasteProgress: PasteProgressReporter = {
  begin(total, onCancel) {
    emit({ active: true, total, done: 0, onCancel });
  },
  advance(done) {
    if (snapshot.active) emit({ ...snapshot, done });
  },
  end() {
    if (snapshot.active) emit(idle);
  },
};

/** A reporter that records nothing, for paths and tests that want no UI. */
export const silentPasteProgress: PasteProgressReporter = {
  begin() {},
  advance() {},
  end() {},
};
