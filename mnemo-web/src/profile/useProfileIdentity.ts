import { useSettingValue } from "@/settings/store"

import { DEFAULT_PROFILE_COLOUR, profileColour } from "./profile-colours"
import { useProfilePictureUrl } from "./useProfilePictureUrl"

export function useProfileIdentity() {
  const name = useSettingValue("User.DisplayName", "")
  const colour = profileColour(useSettingValue("User.ProfileColour", DEFAULT_PROFILE_COLOUR))
  const storedPicture = useSettingValue("User.ProfilePicture", "")
  const pictureUrl = useProfilePictureUrl(storedPicture)

  return { name, colour, storedPicture, pictureUrl }
}
