import type { ReactNode } from "react"

/** The heading a question step opens with. */
export function Head({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{title}</h1>
      <p className="mt-2 max-w-[460px] text-[13.5px] leading-relaxed text-ink-2">{body}</p>
    </div>
  )
}

/** A labelled control on its own line: the settings row, without the column. */
export function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex h-12 items-center justify-between gap-4 rounded-xl px-3.5 shadow-[0_0_0_1px_var(--line-soft)]">
      <span className="min-w-0 truncate text-[13.5px] text-ink">{label}</span>
      {children}
    </div>
  )
}
