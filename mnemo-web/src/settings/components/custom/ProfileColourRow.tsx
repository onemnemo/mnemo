import { ProfileColourPicker } from "@/profile/ProfileColourPicker"
import { DEFAULT_PROFILE_COLOUR, profileColour } from "@/profile/profile-colours"

import { useSettingsStore, useSettingValue } from "../../store"
import { SettingRowShell } from "../SettingRowShell"

export function ProfileColourRow({
  title,
  description,
  divider,
}: {
  title: string
  description?: string
  divider: boolean
}) {
  const stored = useSettingValue("User.ProfileColour", DEFAULT_PROFILE_COLOUR)
  const setValue = useSettingsStore((state) => state.setValue)

  return (
    <SettingRowShell title={title} description={description} divider={divider}>
      <ProfileColourPicker
        value={profileColour(stored)}
        onChange={(value) => void setValue("User.ProfileColour", value)}
      />
    </SettingRowShell>
  )
}
