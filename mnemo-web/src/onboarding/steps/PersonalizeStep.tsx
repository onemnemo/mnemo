import { useT } from "@/i18n/useT"
import {
  APP_ICONS,
  DEFAULT_APP_ICON,
  DEFAULT_PROFILE_PICTURE,
  PROFILE_PICTURES,
  appIconName,
} from "@/settings/assets"
import { ImageGalleryRow } from "@/settings/components/custom/ImageGalleryRow"
import { ThemeGalleryRow } from "@/settings/components/custom/ThemeGalleryRow"

/**
 * Name, theme, app icon and avatar, the same pickers the settings page uses, under
 * the wizard's own labels. They write through as they are clicked, so only the name
 * is held for the step transition to commit.
 */
export function PersonalizeStep({
  name,
  onNameChange,
}: {
  name: string
  onNameChange: (next: string) => void
}) {
  const t = useT()

  return (
    <div className="py-1">
      <label className="block py-3.5">
        <span className="text-body-small font-medium text-text-primary">
          {t("Onboarding", "YourName")}
        </span>
        <input
          value={name}
          autoFocus
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={t("Onboarding", "EnterYourName")}
          className="mt-2 h-[34px] w-full rounded-sm border border-input bg-[var(--text-control-background)] px-2.5 text-body-small text-text-primary outline-none placeholder:text-[var(--text-control-placeholder-foreground)] focus:border-[var(--text-control-border-focused)]"
        />
      </label>

      <ThemeGalleryRow
        title={t("Onboarding", "Theme")}
        description={t("Onboarding", "ThemeDescription")}
        divider
      />

      <ImageGalleryRow
        settingKey="User.ProfilePicture"
        options={PROFILE_PICTURES}
        defaultValue={DEFAULT_PROFILE_PICTURE}
        title={t("Onboarding", "ProfilePictureLabel")}
        description={t("Onboarding", "ProfilePictureDescription")}
        divider
        labelFor={(stored) => stored.split("/").pop() ?? stored}
      />

      <ImageGalleryRow
        settingKey="App.Icon"
        options={APP_ICONS}
        defaultValue={DEFAULT_APP_ICON}
        title={t("Onboarding", "AppIconLabel")}
        description={t("Onboarding", "AppIconDescription")}
        divider={false}
        shape="rounded"
        size={48}
        labelFor={appIconName}
      />
    </div>
  )
}
