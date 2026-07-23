import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { EditorView } from 'prosemirror-view';

import { AppIcon } from '@/components/icon/AppIcon';
import { useT } from '@/i18n/useT';
import { cn } from '@/lib/utils';

import type { BlockRegistry } from '../editor/registry/build';
import { documentHeadings, type HeadingEntry } from '../editor/projection/headings';

/**
 * The floating index: a pill in the corner of the editor that opens the note's
 * heading outline and shows how far down the reader is.
 *
 * The outline is the shared heading projection, so a click scrolls to a position
 * the editor agrees is that block. The reading percent is a plain scroll
 * fraction, and the current section is the last heading at or above the top of
 * the viewport, approximate on purpose: exact tracking is not worth reflowing a
 * large document on every scroll frame.
 */
export function IndexChip({
  view,
  registry,
  scrollRef,
}: {
  view: EditorView;
  registry: BlockRegistry;
  scrollRef: RefObject<HTMLElement | null>;
}) {
  const t = useT();
  const nt = (key: string) => t('Notes', key);

  const [open, setOpen] = useState(false);
  const [percent, setPercent] = useState(0);
  const [headings, setHeadings] = useState<HeadingEntry[]>([]);
  const [activeSid, setActiveSid] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chipRef = useRef<HTMLDivElement>(null);

  const readOutline = useCallback(() => documentHeadings(view.state.doc, registry), [view, registry]);

  const currentHeading = useCallback(
    (list: HeadingEntry[]): string | null => {
      const container = scrollRef.current;
      if (!container || list.length === 0) return null;
      const top = container.getBoundingClientRect().top + 8;
      let current: string | null = list[0].sid;
      for (const heading of list) {
        try {
          const coords = view.coordsAtPos(heading.pos + 1);
          if (coords.top <= top) current = heading.sid;
          else break;
        } catch {
          break;
        }
      }
      return current;
    },
    [scrollRef, view],
  );

  const updateProgress = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const scrollable = container.scrollHeight - container.clientHeight;
    setPercent(scrollable <= 0 ? 100 : Math.round((container.scrollTop / scrollable) * 100));
    setActiveSid((prev) => {
      const next = currentHeading(readOutline());
      return next === prev ? prev : next;
    });
  }, [scrollRef, currentHeading, readOutline]);

  // Track scroll: refresh the percent and the current section, and light the chip
  // up briefly so it is legible while the reader is moving.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    updateProgress();
    const onScroll = () => {
      updateProgress();
      setActive(true);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => setActive(false), 1300);
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [scrollRef, updateProgress]);

  // Close the popover on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!chipRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const toggle = () => {
    const next = !open;
    if (next) {
      const list = readOutline();
      setHeadings(list);
      setActiveSid(currentHeading(list));
    }
    setOpen(next);
  };

  const scrollTo = (heading: HeadingEntry) => {
    setOpen(false);
    const container = scrollRef.current;
    if (!container) return;
    try {
      const dom = view.nodeDOM(heading.pos);
      const element = dom instanceof HTMLElement ? dom : (dom?.parentElement ?? null);
      if (!element) return;
      const delta = element.getBoundingClientRect().top - container.getBoundingClientRect().top;
      container.scrollTop += delta - 24;
    } catch {
      // A virtualized-out block has no node; leave the scroll where it is rather
      // than jumping to a guessed offset.
    }
  };

  return (
    <div ref={chipRef} className="absolute bottom-3.5 left-4 z-20">
      {open ? (
        <div className="absolute bottom-full mb-2 w-[254px] rounded-lg border border-line bg-popover p-2 shadow-elevation-4">
          <div className="max-h-[320px] overflow-y-auto">
            {headings.length === 0 ? (
              <div className="px-2 py-6 text-center text-body-extra-small text-text-faded">{nt('IndexEmpty')}</div>
            ) : (
              headings.map((heading, i) => (
                <button
                  key={heading.sid || `h:${String(i)}`}
                  type="button"
                  onClick={() => scrollTo(heading)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left',
                    heading.sid === activeSid ? 'bg-[var(--widget-background-hover)]' : 'hover:bg-[var(--widget-background-hover)]',
                  )}
                  style={{ paddingLeft: 8 + (heading.level - 1) * 10 }}
                >
                  <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-text-faded">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-body-extra-small',
                      heading.sid === activeSid ? 'font-medium text-text-primary' : 'text-text-secondary',
                    )}
                  >
                    {heading.text}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={toggle}
        aria-label={nt('IndexChip')}
        className={cn(
          'flex h-[30px] items-center gap-2 rounded-full border border-[var(--floating-chrome-divider)] bg-[var(--floating-chrome-background,var(--popover))] px-3 shadow-elevation-2 transition-opacity',
          open || active ? 'opacity-100' : 'opacity-75 hover:opacity-100',
        )}
      >
        <AppIcon name="common/menu" size={12} className="text-[var(--floating-chrome-foreground)]" />
        <span className="text-body-extra-small text-[var(--floating-chrome-foreground)]">{nt('IndexChip')}</span>
        <span className="h-3 w-px bg-[var(--floating-chrome-divider)]" />
        <span className="font-mono text-[10.5px] tabular-nums text-[var(--floating-chrome-foreground-strong)]">{percent}%</span>
      </button>
    </div>
  );
}
