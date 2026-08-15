import { useMemo, useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { useChatStore } from "../store"
import type { ChatConversationSummary } from "../types"
import { useConversationActions } from "./useConversationActions"

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

/**
 * The list of conversations, inside Soma's own canvas.
 *
 * Deliberately not a second app frame. It carries no brand mark, no profile row and no
 * window controls, because the ones in the frame around it are still there: this is a
 * list of chats and nothing else.
 */
export function ChatHistorySidebar({ collapsed, onToggle }: SidebarProps) {
  const t = useT()
  const conversations = useChatStore((s) => s.conversations)
  const activeId = useChatStore((s) => s.activeId)
  const newChat = useChatStore((s) => s.newChat)
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return conversations
    return conversations.filter((c) => (c.title ?? "").toLowerCase().includes(needle))
  }, [conversations, query])

  if (collapsed) {
    return (
      <aside className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-line-soft bg-canvas py-2.5">
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
    <aside className="flex w-[248px] shrink-0 flex-col border-r border-line-soft bg-canvas">
      <div className="flex items-center gap-1 px-2 pt-2.5">
        <button
          type="button"
          onClick={newChat}
          className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium text-ink shadow-[0_0_0_1px_var(--line)] transition-colors hover:bg-frame-hover"
        >
          <AppIcon name="common/plus" size={15} className="text-ink-2" />
          <span className="truncate">{t("Chat", "NewChat")}</span>
        </button>
        <IconAction icon="common/layout-sidebar" label={t("Chat", "ChatHistory")} onClick={onToggle} />
      </div>

      <div className="px-2 pt-2 pb-1">
        <div className="flex h-8 items-center gap-1.5 rounded-lg bg-canvas-sunken px-2 focus-within:shadow-[0_0_0_1px_var(--line)]">
          <AppIcon name="search" size={14} className="shrink-0 text-ink-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Chat", "SearchChats")}
            aria-label={t("Chat", "SearchChats")}
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink placeholder:text-ink-3 focus:outline-none"
          />
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {filtered.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12.5px] text-ink-3">
            {query.trim() ? t("Chat", "NoChatsFound") : t("Chat", "RecentSessions")}
          </p>
        ) : (
          filtered.map((convo) => {
            const section = sectionKeyFor(convo.lastActivityUtc, startMs)
            const showHeader = section !== lastSection
            lastSection = section
            return (
              <div key={convo.id}>
                {showHeader ? (
                  <div className="px-2 pt-3 pb-1 text-[11px] font-semibold text-ink-3">{t("Chat", section)}</div>
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
  const { rename, remove } = useConversationActions(convo.id, convo.title)

  const title = convo.title ?? t("Chat", "NewChat")

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          onClick={() => void selectConversation(convo.id)}
          className={cn(
            "flex h-8 w-full items-center rounded-md px-2 text-left text-[13.5px] transition-colors",
            active ? "bg-frame-active font-medium text-ink" : "text-ink-2 hover:bg-frame-hover hover:text-ink",
          )}
        >
          <span className="truncate">{title}</span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent opensDialog>
        <ContextMenuItem icon="common/pencil" onSelect={() => void rename()}>
          {t("Chat", "RenameChat")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem icon="trash-2" danger onSelect={() => void remove()}>
          {t("Chat", "DeleteChatTitle")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function IconAction({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-frame-hover hover:text-ink"
    >
      <AppIcon name={icon} size={16} />
    </button>
  )
}
