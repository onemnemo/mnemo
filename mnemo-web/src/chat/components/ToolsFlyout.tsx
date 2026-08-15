import { AppIcon } from "@/components/icon/AppIcon"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { useT } from "@/i18n/useT"
import { useSettingsStore, useSettingValue } from "@/settings/store"

import { useChatStore } from "../store"

/**
 * What Soma is allowed to do, from the composer.
 *
 * Two switches, not a tick list of every capability. The long version of this is a
 * permissions screen, and a composer menu that disagrees with the settings page is worse
 * than no menu at all, so both rows write the same keys the settings page reads.
 */
export function ToolsFlyout() {
  const t = useT()

  const webSearch = useChatStore((s) => s.webSearchEnabled)
  const setWebSearch = useChatStore((s) => s.setWebSearch)

  const agentMode = useSettingValue("AI.AgentMode", false)
  const setSetting = useSettingsStore((s) => s.setValue)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={t("Chat", "Tools")}
          aria-label={t("Chat", "Tools")}
          className="grid size-8 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-frame-hover hover:text-ink data-[state=open]:bg-frame-active data-[state=open]:text-ink"
        >
          <AppIcon name="settings-2" size={16} />
        </button>
      </PopoverTrigger>

      <PopoverContent side="top" align="start" className="w-[288px] p-2">
        <ToolRow
          label={t("Chat", "WebSearch")}
          description={t("Chat", "WebSearchHint")}
          checked={webSearch}
          onChange={setWebSearch}
        />
        <ToolRow
          label={t("Settings", "AgentMode")}
          description={t("Chat", "AgentModeHint")}
          checked={agentMode}
          onChange={(next) => void setSetting("AI.AgentMode", next)}
        />
        <p className="px-1.5 pt-2 pb-1 text-[11px] text-ink-3">{t("Chat", "ToolsSavedInSettings")}</p>
      </PopoverContent>
    </Popover>
  )
}

function ToolRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg px-1.5 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-ink">{label}</div>
        <p className="mt-0.5 text-[11.5px] leading-[1.45] text-ink-3">{description}</p>
      </div>
      <Switch checked={checked} onChange={onChange} label={label} className="mt-0.5" />
    </div>
  )
}
