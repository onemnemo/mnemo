import type { ReactNode } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"

// The empty-conversation state: greeting, the shared composer, and four
// quick-start pills that send their prompt immediately (as the desktop does).
const PILLS: { titleKey: string; promptKey: string; icon: string }[] = [
  { titleKey: "QuickActionFlashcards", promptKey: "QuickActionFlashcardsPrompt", icon: "sidebar/flashcard" },
  { titleKey: "QuickActionSummarize", promptKey: "QuickActionSummarizePrompt", icon: "common/file-text" },
  { titleKey: "QuickActionQuiz", promptKey: "QuickActionQuizPrompt", icon: "common/pencil" },
  { titleKey: "QuickActionConceptMap", promptKey: "QuickActionConceptMapPrompt", icon: "common/sitemap" },
]

interface ChatLandingProps {
  composer: ReactNode
  onQuickAction: (prompt: string) => void
}

export function ChatLanding({ composer, onQuickAction }: ChatLandingProps) {
  const t = useT()
  return (
    <div className="mx-auto flex min-h-full w-full max-w-[700px] flex-col justify-center px-6 py-10">
      <h1 className="text-center text-heading-3 font-semibold text-foreground">{t("Chat", "GreetingNoName")}</h1>
      <p className="mt-1 text-center text-body-medium text-text-tertiary">{t("Chat", "GreetingSubtitle")}</p>

      <div className="mt-6">{composer}</div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {PILLS.map((pill) => (
          <button
            key={pill.titleKey}
            type="button"
            onClick={() => onQuickAction(t("Chat", pill.promptKey))}
            className="flex flex-col items-start gap-2 rounded-xl border border-line p-3 text-left transition-colors hover:bg-surface-subtle"
          >
            <AppIcon name={pill.icon} size={18} className="text-brand" />
            <span className="text-body-small font-medium text-text-secondary">{t("Chat", pill.titleKey)}</span>
          </button>
        ))}
      </div>

      <p className="mt-5 text-center text-caption text-text-faded">{t("Chat", "Disclaimer")}</p>
    </div>
  )
}
