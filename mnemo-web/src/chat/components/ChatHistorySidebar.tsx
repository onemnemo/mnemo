import { DropdownMenu } from "radix-ui"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"
import { dialog } from "@/stores/dialog"

import { useChatStore } from "../store"
import type { ChatConversationSummary } from "../types"

const DAY_MS = 86_400_000

function sectionKeyFor(iso: string, startOfToday: number): string {
  const d = new Date(iso).getTime()
  if (Number.isNaN(d) || d >= startOfToday) return "SectionToday"
  if (d >= startOfToday - DAY_MS) return "SectionYesterday"
  if (d >= startOfToday - 7 * DAY_MS) return "SectionPrevious7Days"
  return "SectionOlder"
}

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export function ChatHistorySidebar({ collapsed, onToggle }: SidebarProps) {
  const t = useT()
  const conversations = useChatStore((s) => s.conversations)
  const activeId = useChatStore((s) => s.activeId)
  const newChat = useChatStore((s) => s.newChat)

  if (collapsed) {
    return (
      <aside className="flex w-12 shrink-0 flex-col items-center gap-2 border-r border-line bg-sidebar-surface py-2.5">
        <IconAction icon="common/layout-sidebar" label={t("Chat", "ChatHistory")} onClick={onToggle} />
        <IconAction icon="common/plus" label={t("Chat", "NewChat")} onClick={newChat} />
      </aside>
    )
  }

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const startMs = startOfToday.getTime()

  let lastSection = ""

  return (
    <aside className="flex w-[264px] shrink-0 flex-col border-r border-line bg-sidebar-surface">
      <div className="flex items-center gap-1 px-3 py-2.5">
        <span className="flex-1 text-body-small font-semibold text-text-secondary">{t("Chat", "ChatHistory")}</span>
        <IconAction icon="common/plus" label={t("Chat", "NewChat")} onClick={newChat} />
        <IconAction icon="common/layout-sidebar" label={t("Chat", "ChatHistory")} onClick={onToggle} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {conversations.length === 0 ? (
          <p className="px-2 py-6 text-center text-body-small text-text-faded">{t("Chat", "RecentSessions")}</p>
        ) : (
          conversations.map((convo) => {
            const section = sectionKeyFor(convo.lastActivityUtc, startMs)
            const showHeader = section !== lastSection
            lastSection = section
            return (
              <div key={convo.id}>
                {showHeader ? (
                  <div className="px-2 pt-3 pb-1 text-caption font-semibold tracking-wide text-text-faded uppercase">
                    {t("Chat", section)}
                  </div>
                ) : null}
                <ConversationRow convo={convo} active={convo.id === activeId} />
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}

function ConversationRow({ convo, active }: { convo: ChatConversationSummary; active: boolean }) {
  const t = useT()
  const selectConversation = useChatStore((s) => s.selectConversation)
  const renameConversation = useChatStore((s) => s.renameConversation)
  const deleteConversation = useChatStore((s) => s.deleteConversation)

  const title = convo.title ?? t("Chat", "NewChat")

  const rename = async () => {
    const value = await dialog.prompt({
      title: t("Chat", "RenameChat"),
      defaultValue: convo.title ?? "",
      placeholder: t("Chat", "RenameChatPlaceholder"),
      confirmLabel: t("Chat", "SaveAndSubmit"),
    })
    if (value !== null) await renameConversation(convo.id, value)
  }

  const remove = async () => {
    const ok = await dialog.confirm({
      title: t("Chat", "DeleteChatTitle"),
      message: t("Chat", "DeleteChatMessage"),
      destructive: true,
      confirmLabel: t("Chat", "DeleteChatTitle"),
    })
    if (ok) await deleteConversation(convo.id)
  }

  return (
    <div
      className={cn(
        "group flex items-center rounded-md transition-colors",
        active ? "bg-[var(--navigation-button-background-selected)]" : "hover:bg-[var(--navigation-button-background-hover)]",
      )}
    >
      <button
        type="button"
        onClick={() => void selectConversation(convo.id)}
        className={cn(
          "min-w-0 flex-1 truncate px-2 py-1.5 text-left text-body-small",
          active ? "font-medium text-[var(--navigation-button-foreground-selected)]" : "text-text-secondary",
        )}
      >
        {title}
      </button>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label={t("Chat", "MoreChatActions")}
            title={t("Chat", "MoreChatActions")}
            className="mr-1 grid size-6 place-items-center rounded text-text-faded opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface-subtle hover:text-text-secondary aria-expanded:opacity-100 data-[state=open]:opacity-100"
          >
            <AppIcon name="common/dots-vertical-filled" size={14} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className="z-50 min-w-[140px] rounded-lg border border-line bg-popover p-1 shadow-[var(--elevation-2)]"
          >
            <DropdownMenu.Item
              onSelect={() => void rename()}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-body-small text-text-secondary outline-none select-none data-[highlighted]:bg-surface-subtle data-[highlighted]:text-foreground"
            >
              <AppIcon name="common/pencil" size={14} />
              {t("Chat", "RenameChat")}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={() => void remove()}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-body-small text-destructive outline-none select-none data-[highlighted]:bg-destructive/10"
            >
              <AppIcon name="common/x" size={14} />
              {t("Chat", "DeleteChatTitle")}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}

function IconAction({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-7 place-items-center rounded-md text-text-tertiary transition-colors hover:bg-surface-subtle hover:text-text-primary"
    >
      <AppIcon name={icon} size={16} />
    </button>
  )
}
