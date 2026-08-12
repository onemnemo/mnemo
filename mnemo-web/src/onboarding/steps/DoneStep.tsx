import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"

/** The closing statement. No Save button, because nothing was waiting on one. */
export function DoneStep({ onStart }: { onStart: () => void }) {
  const t = useT()

  return (
    <div className="text-center">
      <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-ok-wash">
        <AppIcon name="check" size={20} strokeWidth={2.2} className="text-ok-ink" />
      </span>

      <h1 className="mt-6 text-[24px] font-semibold tracking-[-0.022em] text-ink">
        {t("Onboarding", "DoneTitle")}
      </h1>
      <p className="mx-auto mt-3 max-w-[430px] text-[13.5px] leading-relaxed text-ink-2">
        {t("Onboarding", "DoneBody")}
      </p>

      <Button variant="solid" className="mt-8 h-9 px-4" onClick={onStart}>
        {t("Onboarding", "DoneStart")}
      </Button>
    </div>
  )
}
