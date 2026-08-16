import type { ReactNode } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { useSettingValue } from "@/settings/store"

import { QUICK_ACTIONS } from "../quick-actions"
import { THREAD_MEASURE } from "./ChatThread"
import { SomaMark } from "./SomaMark"

// The empty-conversation state: the mark, a greeting, the shared composer, and the four
// quick starts.

interface ChatLandingProps {
  composer: ReactNode
  onQuickAction: (prompt: string) => void
}

export function ChatLanding({ composer, onQuickAction }: ChatLandingProps) {
  const t = useT()
  // Falls back to the nameless greeting until a display name is set, as the desktop does.
  const name = useSettingValue("User.DisplayName", "").trim()
  const greeting = name ? t("Chat", "GreetingFormat", { 0: name }) : t("Chat", "GreetingNoName")

  return (
    <div
      className="mx-auto flex min-h-full w-full flex-col justify-center px-6 py-10"
      style={{ maxWidth: THREAD_MEASURE }}
    >
      {/* Left-aligned, not centred. The composer under it is where you are going, and a
          centred column makes the eye restart at every line on the way down. */}
      <SomaMark size={28} />
      <h1 className="mt-4 text-[26px] leading-tight font-semibold tracking-[-0.02em] text-ink">{greeting}</h1>
      <p className="mt-1.5 text-[14px] text-ink-3">{t("Chat", "GreetingSubtitle")}</p>

      <div className="mt-6">{composer}</div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.titleKey}
            type="button"
            onClick={() => onQuickAction(t("Chat", action.promptKey))}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] text-ink-2 shadow-[0_0_0_1px_var(--line-soft)] transition-colors hover:bg-frame-hover hover:text-ink"
          >
            <AppIcon name={action.icon} size={14} className="text-ink-3" />
            {t("Chat", action.titleKey)}
          </button>
        ))}
      </div>

      <p className="mt-6 text-[11px] text-ink-3">{t("Chat", "Disclaimer")}</p>
    </div>
  )
}
