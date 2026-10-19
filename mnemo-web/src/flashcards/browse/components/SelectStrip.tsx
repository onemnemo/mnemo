import type { ReactNode } from "react"

/** Darkens an empty box's ring while the pointer is anywhere in its strip, not only on the box. */
export const STRIP_HOVER = "group-hover/strip:shadow-[0_0_0_1.5px_var(--ink-3)]"

/**
 * The selection gutter: the checkbox's cell stretched over the row's left padding, the gap
 * after it and the full row height. Nothing else lives there, so a press anywhere in it is
 * a press on the box.
 */
export function SelectStrip({ onToggle, children }: { onToggle: () => void; children: ReactNode }) {
  return (
    <span
      data-row-check
      onClick={(event) => {
        event.stopPropagation()
        // The box answers its own click; the rest of the strip answers here.
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
