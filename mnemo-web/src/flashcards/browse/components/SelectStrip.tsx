import type { ReactNode } from "react"

/** Darkens an empty box's ring while the pointer is anywhere in its strip. */
export const STRIP_HOVER = "group-hover/strip:shadow-[0_0_0_1.5px_var(--ink-3)]"

/**
 * The selection gutter: the checkbox cell stretched over the row's left padding, the gap
 * after it and the full row height. A press anywhere in it is a press on the box.
 */
export function SelectStrip({ onToggle, children }: { onToggle: () => void; children: ReactNode }) {
  return (
    <span
      data-row-check
      onClick={(event) => {
        event.stopPropagation()
        // The box handles its own click. The rest of the strip toggles it here.
        if ((event.target as Element).closest("button")) return
        onToggle()
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      className="group/strip -ml-2 -mr-3 grid cursor-pointer place-items-center self-stretch pl-2 pr-3"
    >
      {children}
    </span>
  )
}
