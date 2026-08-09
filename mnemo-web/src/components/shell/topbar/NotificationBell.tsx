import { useEffect, useRef, useState } from "react"
import { DropdownMenu, Popover } from "radix-ui"

import { AppIcon } from "@/components/icon/AppIcon"
import { agoLabel, bucketOf, NOTIFICATION_MARK, type Bucket } from "@/components/shell/topbar/notification-model"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"
import { type NotificationEntry, useToastStore } from "@/stores/toast"

type Tab = "all" | "unread"

export function NotificationBell() {
  const t = useT()
  const history = useToastStore((s) => s.history)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>("all")

  const unseen = history.filter((n) => !n.seen).length
  const unread = history.filter((n) => !n.read).length

  // Opening kills the dot immediately; closing is what finally clears the row
  // markers, so the list you are looking at stays the list you opened.
  //
  // The ref is load-bearing: without it the closed state on first mount reads as
  // "you just closed the menu", and everything is marked read before the app has
  // finished starting up.
  const opened = useRef(false)
  useEffect(() => {
    if (open) {
      opened.current = true
      useToastStore.getState().markAllSeen()
    } else if (opened.current) {
      useToastStore.getState().markAllRead()
    }
  }, [open])

  const title = t("Topbar", "NotificationsTitle")

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={title}
          title={title}
          className={cn(
            "relative grid size-8 shrink-0 place-items-center self-center rounded-lg transition-colors",
            open ? "bg-frame-active text-ink" : "text-ink-2 hover:bg-frame-hover hover:text-ink",
          )}
          style={{ transitionDuration: "var(--duration-fast)" }}
        >
          <AppIcon name="bell" size={16} strokeWidth={1.6} />
          {unseen > 0 && (
            <span className="absolute right-1.5 top-1.5 size-[5px] rounded-full bg-accent ring-2 ring-frame" />
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          aria-label={title}
          className="animate-pop-in z-[150] flex max-h-[min(540px,72vh)] w-96 flex-col overflow-hidden rounded-xl bg-canvas shadow-pop focus:outline-none"
        >
          {/* Tabs rather than a heading: the count is the useful word here, and
              "Notifications" is already written on the button you just pressed. */}
          <header className="flex shrink-0 items-center gap-1 py-1.5 pl-1 pr-1.5">
            <Tab active={tab === "all"} onClick={() => setTab("all")} label={t("Topbar", "NotificationsAll")} />
            <Tab
              active={tab === "unread"}
              onClick={() => setTab("unread")}
              label={t("Topbar", "NotificationsUnread")}
              count={unread}
            />
            <div className="flex-1" />
            <Overflow onNavigate={() => setOpen(false)} />
          </header>

          <NotificationList tab={tab} history={history} onNavigate={() => setOpen(false)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function NotificationList({
  tab,
  history,
  onNavigate,
}: {
  tab: Tab
  history: NotificationEntry[]
  onNavigate: () => void
}) {
  const t = useT()
  // Read once per render rather than per row, so every row in one paint agrees
  // about what "now" is.
  const now = Date.now()
  const shown = tab === "unread" ? history.filter((n) => !n.read) : history

  if (shown.length === 0) return <Empty unreadOnly={tab === "unread"} />

  let lastBucket: Bucket | null = null

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-1 pb-1">
      {shown.map((entry) => {
        const bucket = bucketOf(entry.createdAt, now)
        const heading = bucket === lastBucket ? null : bucket
        lastBucket = bucket
        return (
          <div key={entry.id}>
            {heading && (
              <p className="px-2.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-3">
                {t("Topbar", BUCKET_KEY[heading])}
              </p>
            )}
            <Row entry={entry} now={now} onNavigate={onNavigate} />
          </div>
        )
      })}
    </div>
  )
}

const BUCKET_KEY: Record<Bucket, string> = {
  today: "BucketToday",
  yesterday: "BucketYesterday",
  earlier: "BucketEarlier",
}

function Row({ entry, now, onNavigate }: { entry: NotificationEntry; now: number; onNavigate: () => void }) {
  const t = useT()
  const [leaving, setLeaving] = useState(false)
  const mark = NOTIFICATION_MARK[entry.type]

  function dismiss(): void {
    setLeaving(true)
    window.setTimeout(() => useToastStore.getState().dismissNotification(entry.id), 180)
  }

  return (
    <div
      className="grid transition-[grid-template-rows,opacity] ease-out"
      style={{
        gridTemplateRows: leaving ? "0fr" : "1fr",
        opacity: leaving ? 0 : 1,
        transitionDuration: "var(--duration-normal)",
      }}
    >
      <div className="min-h-0 overflow-hidden">
        {/* Clicking a row consumes just that one. It is the fastest way to clear
            a list down to the two things you care about, and it means "mark all
            as read" is never the only option. */}
        <div
          onClick={() => !entry.read && useToastStore.getState().markRead(entry.id)}
          className="group/row relative flex cursor-default gap-2 rounded-lg py-2 pl-1 pr-1.5 transition-colors hover:bg-frame-hover"
          style={{ transitionDuration: "var(--duration-fast)" }}
        >
          <span className="flex w-2.5 shrink-0 justify-center pt-[13px]">
            <span
              className={cn("size-[5px] rounded-full bg-accent transition-opacity", entry.read ? "opacity-0" : "opacity-100")}
              style={{ transitionDuration: "var(--duration-slow)" }}
            />
          </span>

          <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-[9px]", mark.bg)}>
            <AppIcon name={mark.icon} size={14} strokeWidth={1.9} className={mark.fg} />
          </span>

          <div className="min-w-0 flex-1 pt-0.5">
            <p
              className={cn(
                "pr-6 text-[13px] leading-[17px] tracking-[-0.006em]",
                entry.read ? "text-ink-2" : "font-medium text-ink",
              )}
            >
              {entry.title}
            </p>
            {entry.description && <p className="mt-0.5 pr-6 text-[12px] leading-[16px] text-ink-3">{entry.description}</p>}
            {entry.action && (
              <a
                href={entry.action.href}
                onClick={(event) => {
                  event.stopPropagation()
                  useToastStore.getState().markRead(entry.id)
                  onNavigate()
                }}
                className="mt-1.5 inline-flex h-6 items-center rounded-md px-2 text-[12px] font-medium text-ink shadow-[0_0_0_1px_var(--line)] transition-colors hover:bg-canvas-sunken"
                style={{ transitionDuration: "var(--duration-fast)" }}
              >
                {entry.action.label}
              </a>
            )}
          </div>

          {/* Time and dismiss share one box so the row cannot reflow when the
              pointer enters it. */}
          <span className="absolute right-1.5 top-2 grid size-6 place-items-center">
            <span className="absolute text-[11.5px] tabular-nums text-ink-3 transition-opacity group-hover/row:opacity-0">
              {agoLabel(entry.createdAt, now, t("Topbar", "AgoNow"))}
            </span>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                dismiss()
              }}
              aria-label={t("Common", "Close")}
              className="absolute grid size-6 place-items-center rounded-md text-ink-3 opacity-0 transition-[opacity,color,background-color] hover:bg-frame-active hover:text-ink focus-visible:opacity-100 group-hover/row:opacity-100"
            >
              <AppIcon name="x" size={14} strokeWidth={2} />
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}

function Tab({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean
  label: string
  count?: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[13px] transition-colors",
        active ? "bg-frame-active font-medium text-ink" : "text-ink-3 hover:bg-frame-hover hover:text-ink-2",
      )}
      style={{ transitionDuration: "var(--duration-fast)" }}
    >
      {label}
      {count != null && count > 0 && (
        <span
          className={cn(
            "min-w-[16px] rounded-full px-1 text-center text-[10.5px] font-semibold tabular-nums",
            active ? "bg-accent text-accent-fg" : "bg-accent-wash text-accent-ink",
          )}
        >
          {count}
        </span>
      )}
    </button>
  )
}

function Overflow({ onNavigate }: { onNavigate: () => void }) {
  const t = useT()
  const items = [
    { icon: "check-check", label: t("Topbar", "NotificationsMarkAllRead"), run: () => useToastStore.getState().markAllRead() },
    { icon: "trash-2", label: t("Topbar", "NotificationsClearAll"), run: () => useToastStore.getState().clearHistory() },
    {
      icon: "settings",
      label: t("Topbar", "NotificationsSettings"),
      run: () => {
        window.location.hash = "#/settings"
        onNavigate()
      },
    },
  ]

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={t("Topbar", "NotificationsOptions")}
          className="grid size-7 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-frame-hover hover:text-ink"
          style={{ transitionDuration: "var(--duration-fast)" }}
        >
          <AppIcon name="ellipsis" size={16} strokeWidth={1.8} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="animate-pop-in z-[160] min-w-[200px] rounded-xl bg-canvas p-1 shadow-pop focus:outline-none"
        >
          {items.map((item) => (
            <DropdownMenu.Item
              key={item.label}
              onSelect={item.run}
              className="flex h-8 cursor-default items-center gap-2.5 rounded-lg px-2 text-[13px] text-ink-2 outline-none data-[highlighted]:bg-frame-hover data-[highlighted]:text-ink"
            >
              <AppIcon name={item.icon} size={15} strokeWidth={1.7} className="text-ink-icon" />
              {item.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function Empty({ unreadOnly }: { unreadOnly: boolean }) {
  const t = useT()
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <AppIcon name="bell-off" size={20} strokeWidth={1.5} className="text-ink-icon" />
      <p className="text-[13px] text-ink-2">
        {unreadOnly ? t("Topbar", "NotificationsEmptyUnread") : t("Topbar", "NotificationsEmpty")}
      </p>
      <p className="max-w-[240px] text-[12px] leading-[16px] text-ink-3">
        {unreadOnly ? t("Topbar", "NotificationsEmptyUnreadHint") : t("Topbar", "NotificationsEmptyHint")}
      </p>
    </div>
  )
}
