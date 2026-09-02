import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';

import { cn } from '@/lib/utils';

/**
 * The note's title, edited in place at the top of the page.
 *
 * The heading is the field: it keeps the exact type the static heading had,
 * holds plain text only, and commits on blur or Enter, with Escape putting the
 * saved title back. Enter also hands the caret to the document, so naming a new
 * note and writing its first line is one run of typing. Clearing the field puts
 * the saved title back rather than renaming the note to nothing; the
 * placeholder only ever shows while the field is being cleared.
 *
 * The text is written into the element outside React's render: a re-render
 * while the field has focus (the save landing, the tree updating) must not
 * replace the node the caret sits in.
 */
export function NoteTitle({
  title,
  placeholder,
  onCommit,
  onEnter,
  className,
}: {
  title: string;
  placeholder: string;
  onCommit: (title: string) => void;
  /** Called after Enter commits, to move the caret into the document. */
  onEnter?: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLHeadingElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || document.activeElement === el) return;
    if (el.textContent !== title) el.textContent = title;
  }, [title]);

  const commit = () => {
    const el = ref.current;
    if (!el) return;
    const next = (el.textContent ?? '').trim();
    // Clearing the field is not a rename, the same rule the rename dialog keeps:
    // the saved title comes back rather than an empty one going out.
    if (next === '') {
      el.textContent = title;
      return;
    }
    if (next !== title.trim()) onCommit(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLHeadingElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
      ref.current?.blur();
      onEnter?.();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      const el = ref.current;
      if (el) el.textContent = title;
      ref.current?.blur();
    }
  };

  return (
    <h1
      ref={ref}
      // Plain text only: a title is one line of characters, and a rich paste
      // would otherwise land markup in a field the rest of the app reads as text.
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      data-placeholder={placeholder}
      onBlur={commit}
      onKeyDown={onKeyDown}
      className={cn(
        'mt-1 cursor-text text-[2.5rem] font-bold leading-[1.15] tracking-[-0.03em] text-text-primary outline-none',
        'empty:before:pointer-events-none empty:before:text-ink-3 empty:before:content-[attr(data-placeholder)]',
        className,
      )}
    />
  );
}
