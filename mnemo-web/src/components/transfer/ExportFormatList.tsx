import { cn } from "@/lib/utils"

export interface ExportFormatOption {
  formatId: string
  label: string
  caption: string
  extension: string
}

/** The export tab's body. Several formats show as a radio list and a single format as a static row. */
export function ExportFormatList({
  groupLabel,
  contents,
  formats,
  selected,
  busy,
  unavailable,
  onSelect,
}: {
  groupLabel: string
  contents: string
  formats: readonly ExportFormatOption[]
  selected: string | null
  busy: boolean
  /** Shown when the host offers no format for this scope. */
  unavailable: string
  onSelect: (formatId: string) => void
}) {
  return (
    <div className="flex flex-1 flex-col gap-3 px-3 pt-5 pb-3">
      <p className="truncate px-3 text-[13px] text-text-secondary">{contents}</p>
      {formats.length === 0 ? (
        <p className="px-3 text-[12px] text-danger">{unavailable}</p>
      ) : formats.length === 1 ? (
        <div className="flex h-[52px] items-center gap-3 rounded-lg bg-surface-subtle px-3">
          <FormatText format={formats[0]} />
        </div>
      ) : (
        <div role="radiogroup" aria-label={groupLabel} className="flex flex-col">
          {formats.map((format) => {
            const checked = format.formatId === selected
            return (
              <label
                key={format.formatId}
                className={cn(
                  "relative flex h-[52px] cursor-pointer items-center gap-3 rounded-lg px-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
                  checked ? "bg-surface-subtle" : "hover:bg-surface-subtle/60",
                  busy && "pointer-events-none opacity-60",
                )}
              >
                <input
                  type="radio"
                  name="transfer-format"
                  className="absolute size-px opacity-0"
                  checked={checked}
                  disabled={busy}
                  onChange={() => onSelect(format.formatId)}
                />
                <span
                  aria-hidden
                  className={cn(
                    "grid size-[15px] shrink-0 place-items-center rounded-full bg-surface",
                    checked ? "shadow-[inset_0_0_0_1.5px_var(--text-secondary)]" : "shadow-[inset_0_0_0_1.5px_var(--line)]",
                  )}
                >
                  {checked ? <span className="size-[7px] rounded-full bg-text-primary" /> : null}
                </span>
                <FormatText format={format} />
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

function FormatText({ format }: { format: ExportFormatOption }) {
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-text-primary">{format.label}</span>
        {format.caption ? (
          <span className="mt-px block truncate text-[12px] text-text-secondary">{format.caption}</span>
        ) : null}
      </span>
      <span className="text-[12px] text-text-secondary">{format.extension}</span>
    </>
  )
}
