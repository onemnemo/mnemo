import { useT } from "@/i18n/useT"
import { dialog } from "@/stores/dialog"

import { useChatStore } from "../store"

/**
 * Rename and delete for one conversation, prompts included.
 *
 * Shared because the same two actions hang off the history row's context menu and the
 * thread header's menu, and a rename that asks a different question depending on where
 * you started it is the kind of drift nobody notices until it is everywhere.
 */
export function useConversationActions(id: string | null, title: string | null) {
  const t = useT()
  const renameConversation = useChatStore((s) => s.renameConversation)
  const deleteConversation = useChatStore((s) => s.deleteConversation)

  const rename = async () => {
    if (!id) return
    const value = await dialog.prompt({
      title: t("Chat", "RenameChat"),
      defaultValue: title ?? "",
      placeholder: t("Chat", "RenameChatPlaceholder"),
      confirmLabel: t("Chat", "SaveAndSubmit"),
    })
    if (value !== null) await renameConversation(id, value)
  }

  const remove = async () => {
    if (!id) return
    const ok = await dialog.confirm({
      title: t("Chat", "DeleteChatTitle"),
      message: t("Chat", "DeleteChatMessage"),
      destructive: true,
      confirmLabel: t("Chat", "DeleteChatTitle"),
    })
    if (ok) await deleteConversation(id)
  }

  return { rename, remove }
}
