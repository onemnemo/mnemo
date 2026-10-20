import { DEPTH_INDENT } from './row-style';

/** One vertical hairline per nesting level, tracing a row back to its ancestors. */
export function GuideLines({ depth }: { depth: number }) {
  if (depth === 0) return null;
  return (
    <>
      {Array.from({ length: depth }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-px bg-line-soft"
          style={{ left: 12 + i * DEPTH_INDENT }}
        />
      ))}
    </>
  );
}
