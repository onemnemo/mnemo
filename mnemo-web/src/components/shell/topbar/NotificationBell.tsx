import { Popover } from "radix-ui"

import { AppIcon } from "@/components/icon/AppIcon"
import { useToastStore } from "@/stores/toast"

const MAX_SHOWN = 20

// Bell + unread dot + history flyout, fed by the toast store's notification
// history (the same source the desktop app's flyout reads).
export function NotificationBell() {
  const history = useToastStore((s) => s.history)
  const hasItems = history.length > 0

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Notifications"
          title="Notifications"
          className="relative grid size-8 place-items-center rounded-md text-text-tertiary transition-colors hover:bg-[var(--nav-button-hover)] hover:text-text-primary"
        >
          <AppIcon name="common/bell" size={14} />
          {hasItems && (
            <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-brand ring-2 ring-[var(--workspace-background)]" />
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-80 rounded-xl border bg-[var(--overlay-background)] p-3 shadow-elevation-3 focus:outline-none"
        >
          <div className="mb-1 px-1 text-body-small font-semibold text-foreground">Notifications</div>
          {hasItems ? (
            <ul className="flex flex-col">
              {history.slice(0, MAX_SHOWN).map((n) => (
                <li key={n.id} className="flex gap-2.5 rounded-lg p-2.5 hover:bg-[var(--notification-flyout-hover)]">
                  <span
                    className="mt-1 size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: `var(--toast-accent-${n.type})` }}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-body-small font-semibold text-foreground">{n.title}</div>
                    {n.description && <div className="text-caption text-text-secondary">{n.description}</div>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-2 py-6 text-center text-body-small text-text-secondary">No notifications yet</div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
