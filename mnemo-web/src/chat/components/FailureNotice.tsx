import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"

import type { ChatTurnNotice } from "../types"

// The inline card that replaces a failed assistant turn. A missing-key failure
// deep-links to Settings; the others offer a retry. Mirrors the desktop notice.
interface FailureNoticeProps {
  notice: ChatTurnNotice
  onRetry?: () => void
}

export function FailureNotice({ notice, onRetry }: FailureNoticeProps) {
  const t = useT()
  const isMissingKey = notice.kind === "missing_api_key"

  return (
    <div className="flex items-start gap-3 rounded-lg border border-line bg-surface-subtle p-3">
      <AppIcon name="common/triangle-alert" size={16} className="mt-0.5 shrink-0 text-text-tertiary" />
      <div className="min-w-0 flex-1">
        <p className="text-body-small text-text-secondary">{notice.text}</p>
        <div className="mt-2">
          {isMissingKey ? (
            <a
              href="#/settings"
              className="inline-flex items-center rounded-md bg-brand px-2.5 py-1 text-body-extra-small font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              {t("Chat", "OpenSettings")}
            </a>
          ) : onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-body-extra-small font-medium text-text-secondary transition-colors hover:bg-surface hover:text-foreground"
            >
              <AppIcon name="common/refresh" size={12} />
              {t("Chat", "RetryTurn")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
