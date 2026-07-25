import { AppIcon } from "@/components/icon/AppIcon"
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu"

export interface PdfSelectOption<T extends string> {
  value: T
  label: string
  /** A muted figure alongside the label in the menu, e.g. "11 pt". */
  hint?: string
}

/**
 * A labeled dropdown built on the app flyout, the web stand-in for the desktop ModernComboBox: a
 * trigger showing the current choice and a menu that checks the selected row.
 */
export function PdfSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  value: T
  options: readonly PdfSelectOption<T>[]
  onChange: (value: T) => void
  disabled?: boolean
}) {
  const current = options.find((option) => option.value === value)
  return (
    <div className="space-y-1.5">
      <div className="text-caption font-semibold text-text-secondary">{label}</div>
      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={label}
            className="flex h-[34px] w-full items-center gap-2 rounded-md border border-line bg-[var(--widget-background)] px-3 text-body-extra-small text-text-primary outline-none hover:border-text-secondary focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="min-w-0 flex-1 truncate text-left">{current?.label ?? ""}</span>
            {current?.hint ? <span className="font-mono text-caption text-text-tertiary">{current.hint}</span> : null}
            <AppIcon name="common/chevron-down" size={12} className="shrink-0 text-text-tertiary" />
          </button>
        </MenuTrigger>
        <MenuContent align="start">
          {options.map((option) => (
            <MenuItem
              key={option.value}
              icon={option.value === value ? "common/check" : undefined}
              hint={option.hint}
              onSelect={() => onChange(option.value)}
            >
              {option.label}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
    </div>
  )
}
