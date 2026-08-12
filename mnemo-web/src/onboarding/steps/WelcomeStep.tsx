import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"

/**
 * The opening statement. Two ways forward, because every answer in the flow has a sane
 * default: skipping is not an unfinished job, it is a shorter route to the same place.
 */
export function WelcomeStep({ onSetUp, onSkip }: { onSetUp: () => void; onSkip: () => void }) {
  const t = useT()

  return (
    <div className="text-center">
      <div className="flex justify-center">
        <AppIcon name="branding/logo-full" width={204} height={30} className="text-accent" />
      </div>

      <h1 className="mt-9 text-[26px] font-semibold tracking-[-0.022em] text-ink">
        {t("Onboarding", "WelcomeTitle")}
      </h1>
      <p className="mx-auto mt-3 max-w-[430px] text-[13.5px] leading-relaxed text-ink-2">
        {t("Onboarding", "WelcomeBody")}
      </p>

      <div className="mt-8 flex items-center justify-center gap-2">
        <Button variant="solid" className="h-9 px-4" onClick={onSetUp}>
          {t("Onboarding", "WelcomeSetUp")}
        </Button>
        <Button variant="outline" className="h-9 px-4" onClick={onSkip}>
          {t("Onboarding", "Skip")}
        </Button>
      </div>

      <p className="mt-5 text-[12.5px] text-ink-3">{t("Onboarding", "WelcomeNote")}</p>
    </div>
  )
}
