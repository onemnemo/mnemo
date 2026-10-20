import { useEffect, useRef, useState } from 'react';

/**
 * The inline rename field. The draft stays local so Escape reverts it.
 * Its presses stop here so a rename never starts a drag.
 */
export function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const cancelled = useRef(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      value={value}
      autoFocus
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onBlur={() => !cancelled.current && onCommit(value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') onCommit(value);
        if (event.key === 'Escape') {
          cancelled.current = true;
          onCancel();
        }
      }}
      className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none"
    />
  );
}
