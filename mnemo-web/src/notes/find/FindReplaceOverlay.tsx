/**
 * The find/replace bar, mounted as a sibling of the editor like the block
 * gutter. It matches the desktop's overlay: a rounded card pinned to the top
 * right of the editor viewport, a find row, a banded match-count and navigation
 * row, and a replace section that expands on demand.
 *
 * The bar owns no search logic. Every action delegates to `useNoteFind`, which
 * keeps the highlights and the document authority in agreement; this file is
 * only chrome and keyboard wiring.
 */

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { EditorView } from 'prosemirror-view';
import { AppIcon } from '@/components/icon/AppIcon';
import { IconButton } from '@/components/ui/icon-button';
import type { BlockRegistry } from '../editor/registry/build';
import { useNoteFind } from './useNoteFind';

const PANEL_WIDTH = 332;

/** Pins the panel to the top-right of the scrollable editor viewport. */
function useAnchor(view: EditorView): { top: number; left: number } {
  const [anchor, setAnchor] = useState({ top: 72, left: 0 });

  useLayoutEffect(() => {
    const compute = () => {
      const host = view.dom.closest('main') ?? document.documentElement;
      const rect = host.getBoundingClientRect();
      setAnchor({ top: rect.top + 8, left: Math.max(8, rect.right - PANEL_WIDTH - 8) });
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [view]);

  return anchor;
}

interface ToggleChipProps {
  readonly active: boolean;
  readonly label: string;
  readonly title: string;
  readonly onClick: () => void;
}

function ToggleChip({ active, label, title, onClick }: ToggleChipProps) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={`notes-find-chip${active ? ' notes-find-chip-active' : ''}`}
    >
      {label}
    </button>
  );
}

export function FindReplaceOverlay({ view, registry }: { view: EditorView; registry: BlockRegistry }) {
  const find = useNoteFind(view, registry);
  const anchor = useAnchor(view);
  const findInputRef = useRef<HTMLInputElement>(null);

  // Focus and select the query when the bar opens, so a second Ctrl+F or an
  // open with a seeded selection lands ready to type over.
  useEffect(() => {
    if (find.open) {
      const input = findInputRef.current;
      input?.focus();
      input?.select();
    }
  }, [find.open]);

  if (!find.open) return null;

  const countText =
    find.query.length === 0
      ? '0/0'
      : find.count === 0
        ? '0'
        : `${Math.max(find.activeIndex, 0) + 1}/${find.count}`;

  const onFindKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) find.previous();
      else find.next();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      find.close();
    } else if ((event.ctrlKey || event.metaKey) && (event.key === 'f' || event.key === 'F')) {
      // Keep our own find; do not let the browser's native bar open.
      event.preventDefault();
      findInputRef.current?.select();
    }
  };

  const onReplaceKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      find.replaceCurrent();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      find.close();
    }
  };

  return (
    <div
      className="notes-find-replace"
      style={{ top: anchor.top, left: anchor.left, width: PANEL_WIDTH }}
      role="dialog"
      aria-label="Find and replace"
    >
      <div className="notes-find-row">
        <div className="notes-find-field">
          <AppIcon name="common/search" size={15} className="notes-find-field-icon" />
          <input
            ref={findInputRef}
            className="notes-find-input"
            type="text"
            placeholder="Find text"
            value={find.query}
            onChange={(event) => find.setQuery(event.target.value)}
            onKeyDown={onFindKeyDown}
          />
        </div>
        <IconButton icon="common/x" iconSize={16} label="Close" onClick={find.close} />
      </div>

      <div className="notes-find-band">
        <span className="notes-find-count" aria-live="polite">
          {countText}
        </span>
        <div className="notes-find-nav">
          <IconButton
            icon="common/chevron-up"
            iconSize={16}
            label="Previous match"
            disabled={find.count === 0}
            onClick={find.previous}
          />
          <IconButton
            icon="common/chevron-down"
            iconSize={16}
            label="Next match"
            disabled={find.count === 0}
            onClick={find.next}
          />
        </div>
        <div className="notes-find-spacer" />
        <button
          type="button"
          className={`notes-find-toggle${find.replaceOpen ? ' notes-find-toggle-active' : ''}`}
          aria-pressed={find.replaceOpen}
          onClick={find.toggleReplaceOpen}
        >
          <AppIcon name="common/repeat" size={14} />
          <span>Replace</span>
        </button>
      </div>

      {!find.replaceOpen ? (
        <div className="notes-find-options">
          <ToggleChip
            active={find.caseSensitive}
            label="Aa"
            title="Match case"
            onClick={find.toggleCaseSensitive}
          />
          <ToggleChip
            active={find.wholeWord}
            label="Word"
            title="Match whole word"
            onClick={find.toggleWholeWord}
          />
        </div>
      ) : (
        <div className="notes-find-replace-section">
          <input
            className="notes-find-input notes-find-replace-input"
            type="text"
            placeholder="Replace with"
            value={find.replaceText}
            onChange={(event) => find.setReplaceText(event.target.value)}
            onKeyDown={onReplaceKeyDown}
          />
          <div className="notes-find-replace-actions">
            <ToggleChip
              active={find.caseSensitive}
              label="Aa"
              title="Match case"
              onClick={find.toggleCaseSensitive}
            />
            <ToggleChip
              active={find.wholeWord}
              label="Word"
              title="Match whole word"
              onClick={find.toggleWholeWord}
            />
            <div className="notes-find-spacer" />
            <button
              type="button"
              className="notes-find-action"
              disabled={find.count === 0}
              onClick={find.replaceAll}
            >
              All
            </button>
            <button
              type="button"
              className="notes-find-action notes-find-action-primary"
              disabled={find.count === 0}
              onClick={find.replaceCurrent}
            >
              Replace
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
