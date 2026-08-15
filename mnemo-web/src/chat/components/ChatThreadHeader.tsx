import { AppIcon } from "@/components/icon/AppIcon"
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu"
import { useT } from "@/i18n/useT"

import { useChatStore } from "../store"
import { useConversationActions } from "./useConversationActions"

/**
 * The name of the conversation you are in, and what you can do to it.
 *
 * Only rename and delete: everything else Soma could offer here (sharing, saving an
 * answer into your notes) has no way to actually happen yet, and a menu item that does
 * nothing is worse than one that is missing.
 */
export function ChatThreadHeader() {
  const t = useT()
  const activeId = useChatStore((s) => s.activeId)
  const isEphemeral = useChatStore((s) => s.isEphemeral)
  const title = useChatStore((s) => s.conversations.find((c) => c.id === s.activeId)?.title ?? null)

  // An unsaved chat has no server row to rename or delete yet.
  const saved = !!activeId && !isEphemeral
  const { rename, remove } = useConversationActions(saved ? activeId : null, title)

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line-soft px-3">
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
        {title ?? t("Chat", "NewChat")}
      </span>

      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            disabled={!saved}
            aria-label={t("Chat", "MoreChatActions")}
            title={t("Chat", "MoreChatActions")}
            className="grid size-7 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-frame-hover hover:text-ink disabled:opacity-40 data-[state=open]:bg-frame-active"
          >
            <AppIcon name="ellipsis" size={16} />
          </button>
        </MenuTrigger>
        <MenuContent align="end" opensDialog>
          <MenuItem icon="common/pencil" onSelect={() => void rename()}>
            {t("Chat", "RenameChat")}
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon="trash-2" danger onSelect={() => void remove()}>
            {t("Chat", "DeleteChatTitle")}
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  )
}
