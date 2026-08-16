import { useT } from "@/i18n/useT"
import { ThemeGalleryRow } from "@/settings/components/custom/ThemeGalleryRow"

import { Head } from "./kit"

/**
 * The theme, through the picker the Appearance page uses. Onboarding that teaches a
 * control the user will never see again has taught them nothing, and the picker is its
 * own preview: the application changes under you as you click.
 */
export function AppearanceStep() {
  const t = useT()

  return (
    <>
      <Head title={t("Onboarding", "LookTitle")} body={t("Onboarding", "LookBody")} />
      <div className="mt-4">
        <ThemeGalleryRow title={t("Onboarding", "Theme")} divider={false} />
      </div>
    </>
  )
}
