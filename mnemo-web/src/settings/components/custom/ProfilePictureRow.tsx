import { ProfilePictureControl } from "@/profile/ProfilePictureControl"

import { SettingRowShell } from "../SettingRowShell"

export function ProfilePictureRow({
  title,
  description,
  divider,
}: {
  title: string
  description?: string
  divider: boolean
}) {
  return (
    <SettingRowShell title={title} description={description} divider={divider} align="start">
      <ProfilePictureControl />
    </SettingRowShell>
  )
}
