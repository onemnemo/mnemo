import { useEffect, useId, useRef, type ReactNode } from "react"
import { Dialog } from "radix-ui"

import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { useT } from "@/i18n/useT"
import { isMac } from "@/keybinds/chord"
import { cn } from "@/lib/utils"

export type TransferDirection = "import" | "export"

const SHORTCUT_HINT = isMac ? "⌘ ⏎" : "Ctrl ⏎"

/**
 * The frame shared by the notes, mind map and deck transfer dialogs. The body keeps one height in
 * both tabs. The dialog never resizes and the queue scrolls inside it.
 */
export function TransferShell({
  direction,
  both,
  onDirection,
  subtitle,
  busy,
  confirmLabel,
  confirmEnabled,
  confirmClassName,
  leading,
  onConfirm,
  onClose,
  children,
}: {
  direction: TransferDirection
  /** Shows direction tabs in the header instead of a title. */
  both: boolean
  onDirection: (direction: TransferDirection) => void
  /** Shown under the title when the dialog has one direction. */
  subtitle?: string
  busy: boolean
  confirmLabel: string
  confirmEnabled: boolean
  confirmClassName?: string
  leading?: ReactNode
  onConfirm: () => void
  onClose: () => void
  children: ReactNode
}) {
  const t = useT()
  const common = (key: string) => t("Common", key)
  const title = common(direction === "import" ? "TransferImportTab" : "TransferExportTab")
  const panelId = useId()

  // Listens on the document because the dialog is not focused when it opens from a menu item.
  const confirmRef = useRef(onConfirm)
  confirmRef.current = onConfirm
  useEffect(() => {
    if (!confirmEnabled) return
    function onKeyDown(event: KeyboardEvent) {
      if ((isMac ? event.metaKey : event.ctrlKey) && event.key === "Enter") {
        event.preventDefault()
        event.stopPropagation()
        confirmRef.current()
      }
    }
    document.addEventListener("keydown", onKeyDown, true)
    return () => document.removeEventListener("keydown", onKeyDown, true)
  }, [confirmEnabled])

  return (
    <Dialog.Root open onOpenChange={(next) => !next && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex w-[560px] max-w-[calc(100vw-3rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-line bg-[var(--overlay-background)] shadow-pop focus:outline-none"
        >
          {both ? (
            <header className="flex items-center border-b border-divider-subtle pr-4 pl-3.5">
              <Dialog.Title className="sr-only">{title}</Dialog.Title>
              <div role="tablist" aria-label={common("TransferDirectionLabel")} className="flex flex-1 gap-1 self-stretch">
                {(["import", "export"] as const).map((value) => (
                  <DirectionTab
                    key={value}
                    id={`${panelId}-${value}`}
                    panelId={panelId}
                    selected={direction === value}
                    disabled={busy}
                    onSelect={() => onDirection(value)}
                    onOther={() => onDirection(value === "import" ? "export" : "import")}
                  >
                    {common(value === "import" ? "TransferImportTab" : "TransferExportTab")}
                  </DirectionTab>
                ))}
              </div>
              <CloseButton busy={busy} />
            </header>
          ) : (
            <header className="flex items-start gap-3 py-4 pr-4 pl-6">
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-[15px] font-semibold tracking-[-0.01em] text-text-primary">
                  {title}
                </Dialog.Title>
                {subtitle ? <p className="mt-0.5 truncate text-[12px] text-text-secondary">{subtitle}</p> : null}
              </div>
              <CloseButton busy={busy} className="-mt-1" />
            </header>
          )}

          <div
            id={panelId}
            role={both ? "tabpanel" : undefined}
            aria-labelledby={both ? `${panelId}-${direction}` : undefined}
            className={cn("flex h-[280px] flex-col", !both && "border-t border-divider-subtle")}
          >
            {children}
          </div>

          <footer className="flex h-[58px] items-center gap-2 border-t border-divider-subtle bg-surface-subtle px-4">
            <span aria-live="polite" className="sr-only">
              {busy ? confirmLabel : ""}
            </span>
            {leading}
            <div className="flex-1" />
            <Button variant="ghost" className="h-[34px] px-3.5 font-normal" disabled={busy} onClick={onClose}>
              {common("Cancel")}
            </Button>
            <Button
              className={cn("h-[34px] gap-2.5 pr-2 pl-4", confirmClassName)}
              disabled={!confirmEnabled}
              onClick={onConfirm}
            >
              {busy ? <AppIcon name="loader-circle" size={13} className="animate-spin" /> : null}
              {confirmLabel}
              <kbd className="flex h-5 items-center rounded-[5px] bg-solid-fg/15 px-1.5 font-sans text-[11px] font-normal text-solid-fg/70">
                {SHORTCUT_HINT}
              </kbd>
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function CloseButton({ busy, className }: { busy: boolean; className?: string }) {
  const t = useT()
  return (
    <Dialog.Close asChild>
      <IconButton
        icon="common/x"
        iconSize={16}
        label={t("Common", "Close")}
        disabled={busy}
        className={cn("size-8 text-text-tertiary", className)}
      />
    </Dialog.Close>
  )
}

function DirectionTab({
  id,
  panelId,
  selected,
  disabled,
  onSelect,
  onOther,
  children,
}: {
  id: string
  panelId: string
  selected: boolean
  disabled: boolean
  onSelect: () => void
  /** Switches to the other tab, for the arrow keys. */
  onOther: () => void
  children: string
}) {
  return (
    <button
      id={id}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={panelId}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
        event.preventDefault()
        onOther()
        const sibling = event.currentTarget.parentElement?.querySelector<HTMLElement>('[role="tab"]:not([aria-selected="true"])')
        sibling?.focus()
      }}
      className={cn(
        "h-12 px-2.5 text-[14px] transition-colors disabled:opacity-50",
        selected
          ? "font-semibold text-text-primary shadow-[inset_0_-2px_0_var(--solid)]"
          : "text-text-secondary hover:text-text-primary",
      )}
    >
      {children}
    </button>
  )
}
