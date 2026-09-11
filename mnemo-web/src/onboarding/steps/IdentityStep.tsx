import { useEffect, useRef } from "react"

import { useT } from "@/i18n/useT"
import { ProfileColourPicker } from "@/profile/ProfileColourPicker"
import { ProfileMark } from "@/profile/ProfileMark"
import { ProfilePictureControl } from "@/profile/ProfilePictureControl"
import { DEFAULT_PROFILE_COLOUR, profileColour } from "@/profile/profile-colours"
import { useProfileIdentity } from "@/profile/useProfileIdentity"
import { useSettingsStore, useSettingValue } from "@/settings/store"

import { Head } from "./kit"

/**
 * Name, picture and colour.
 *
 * The name is the one answer here not written through on every keystroke: half a typed
 * word is not a name, so it commits when the step is left. Picture and colour are
 * settings in their own right and write as they are changed.
 */
export function IdentityStep({
  name,
  onNameChange,
  onSubmit,
}: {
  name: string
  onNameChange: (next: string) => void
  onSubmit: () => void
}) {
  const t = useT()
  const field = useRef<HTMLInputElement>(null)
  const profile = useProfileIdentity()
  const colour = profileColour(useSettingValue("User.ProfileColour", DEFAULT_PROFILE_COLOUR))
  const setValue = useSettingsStore((state) => state.setValue)

  useEffect(() => field.current?.focus(), [])

  return (
    <>
      <Head title={t("Onboarding", "YouTitle")} body={t("Onboarding", "YouBody")} />

      <div className="mt-8 flex items-end gap-4">
        <ProfileMark
          name={name}
          colour={colour}
          pictureUrl={profile.pictureUrl}
          size={64}
        />
        <div className="min-w-0 flex-1">
          <label htmlFor="onboarding-name" className="block text-[12px] font-medium text-ink-3">
            {t("Onboarding", "YouName")}
          </label>
          <input
            id="onboarding-name"
            ref={field}
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSubmit()}
            placeholder={t("Onboarding", "YouPlaceholder")}
            className="mt-1.5 h-9 w-full rounded-lg bg-transparent px-3 text-[14px] text-ink shadow-[0_0_0_1px_var(--line)] outline-none placeholder:text-ink-3 focus:shadow-[0_0_0_1.5px_var(--solid)]"
          />
        </div>
      </div>

      <div className="mt-5 flex items-start gap-3">
        <div>
          <p className="mb-2 text-[12.5px] text-ink-3">{t("Settings", "ProfileColour")}</p>
          <ProfileColourPicker
            value={colour}
            size="md"
            onChange={(value) => void setValue("User.ProfileColour", value)}
          />
        </div>
        <div className="flex-1" />
        <ProfilePictureControl name={name} showMark={false} />
      </div>
    </>
  )
}
