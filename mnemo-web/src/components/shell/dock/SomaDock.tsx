import { ChatPage } from "@/chat/components/ChatPage"
import { FrameButton } from "@/components/shell/topbar/FrameButton"
import { useT } from "@/i18n/useT"
import { useSettingValue } from "@/settings/store"
import { useSomaStore } from "@/stores/soma"

/**
 * Soma, beside the work instead of instead of it.
 *
 * The rail can navigate to Soma, but navigating away from what you are doing to
 * ask about it defeats the point. The dock is frame furniture for that reason: it
 * lives beside the canvas and survives navigation.
 *
 * The assistant toggle hides it outright rather than disabling it, the same way it
 * hides the rail entry, so an install with the assistant off has no trace of it.
 */
export function SomaDock() {
  const t = useT()
  const enabled = useSettingValue("AI.EnableAssistant", false)
  const open = useSomaStore((s) => s.dockOpen)
  const close = () => useSomaStore.getState().setDockOpen(false)

  if (!enabled || !open) return null

  return (
    <aside
      aria-label="Soma"
      className="flex w-[380px] shrink-0 flex-col border-l border-line-soft bg-frame"
    >
      <div className="flex h-11 shrink-0 items-center justify-between pl-3.5 pr-2">
        <span className="text-[13px] font-medium text-ink">Soma</span>
        <FrameButton icon="x" label={t("Common", "Close")} onClick={close} className="size-7" />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <ChatPage />
      </div>
    </aside>
  )
}
