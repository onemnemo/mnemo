import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { useT } from "@/i18n/useT"
import { openExternally } from "@/lib/external"
import { useProfileBackup } from "@/settings/useProfileBackup"
import { formatVersion } from "@/settings/version"

import { NEW_ISSUE_URL } from "./links"

/** Narrower than the default dialog: a paragraph and one row do not need a gallery's width. */
const WIDTH = 460

interface BetaNoticeProps {
  /** The running build as the host reports it. Shown without its build metadata. */
  version: string
  /** A queued confirmation owns the window, so the notice waits underneath it. */
  suspended: boolean
  onContinue: () => void
}

/**
 * What the first launch of a beta build opens with: that it is a beta, a way to make the same
 * restorable backup Settings offers, and where to report what goes wrong.
 *
 * The wash does not dismiss it. Every other dialog appeared because the user asked for it, and
 * this one did not, so the click they were already making should not be the one that answers it.
 * Escape is a decision and still works. Continue is the acknowledgement; a finished backup does not
 * stand in for it.
 */
export function BetaNotice({ version, suspended, onContinue }: BetaNoticeProps) {
  const t = useT()
  const backup = useProfileBackup()

  function acknowledge() {
    if (!backup.busy) onContinue()
  }

  return (
    <Modal
      open
      onClose={acknowledge}
      title={t("App", "BetaNoticeTitle")}
      eyebrow={
        <div className="flex items-center gap-2.5">
          <AppIcon name="branding/logo-icon" width={20} height={17} className="text-accent" />
          <span className="rounded-md bg-canvas-sunken px-2 py-[3px] text-[11px] font-medium tracking-[0.02em] text-ink-2">
            {t("App", "BetaNoticeBadge", { version: formatVersion(version) })}
          </span>
        </div>
      }
      closeButton={false}
      dismissOnBackdrop={false}
      suspended={suspended}
      width={WIDTH}
      footer={
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            trailing={<AppIcon name="external-link" size={13} strokeWidth={1.7} />}
            onClick={() => openExternally(NEW_ISSUE_URL)}
          >
            {t("App", "BetaNoticeReportBug")}
          </Button>
          {/* Focus starts here rather than on the first control, so Enter answers the notice
              instead of opening the save picker. */}
          <Button variant="solid" size="sm" autoFocus disabled={backup.busy} onClick={acknowledge}>
            {t("Common", "Continue")}
          </Button>
        </div>
      }
    >
      <div className="min-w-0 flex-1 px-5 pb-5">
        <p className="text-[13px] leading-[1.55] text-ink-2">{t("App", "BetaNoticeBody")}</p>

        <div className="mt-4 flex items-center gap-3 rounded-xl bg-canvas-sunken px-3.5 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-ink">{t("Settings", "BackUpMnemo")}</p>
            <p className="mt-0.5 text-[12.5px] leading-snug text-ink-3">{t("App", "BetaNoticeBackupDescription")}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={backup.busy}
            icon={
              <AppIcon
                name={backup.busy ? "loader-circle" : "download"}
                size={13}
                strokeWidth={1.7}
                className={backup.busy ? "animate-spin" : undefined}
              />
            }
            onClick={backup.start}
          >
            {backup.label}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
