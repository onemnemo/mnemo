import { useRef, useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"
import { useSettingsStore } from "@/settings/store"

import {
  isCustomProfilePicture,
  profilePictureUploadProblem,
  uploadProfilePicture,
} from "./assets"
import { ProfileMark } from "./ProfileMark"
import { useProfileIdentity } from "./useProfileIdentity"

export function ProfilePictureControl({
  name,
  showMark = true,
}: {
  name?: string
  showMark?: boolean
}) {
  const t = useT()
  const profile = useProfileIdentity()
  const setValue = useSettingsStore((state) => state.setValue)
  const input = useRef<HTMLInputElement>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const hasPicture = isCustomProfilePicture(profile.storedPicture)

  async function accept(file: File | undefined) {
    if (!file) return

    const rejection = profilePictureUploadProblem(file)
    if (rejection) {
      setProblem(rejection)
      return
    }

    setProblem(null)
    setUploading(true)
    try {
      await setValue("User.ProfilePicture", await uploadProfilePicture(file))
    } catch {
      setProblem("ProfilePictureUploadFailed")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        {showMark ? (
          <ProfileMark
            name={name ?? profile.name}
            colour={profile.colour}
            pictureUrl={profile.pictureUrl}
            size={44}
          />
        ) : null}

        <Button
          variant="outline"
          size="sm"
          disabled={uploading}
          icon={
            <AppIcon
              name={uploading ? "loader-circle" : "image-plus"}
              size={14}
              strokeWidth={1.7}
              className={uploading ? "animate-spin" : undefined}
            />
          }
          onClick={() => input.current?.click()}
        >
          {t("Settings", hasPicture ? "ProfilePictureChange" : "ProfilePictureAdd")}
        </Button>

        {hasPicture ? (
          <Button variant="ghost" size="sm" onClick={() => void setValue("User.ProfilePicture", "")}>
            {t("Settings", "ProfilePictureRemove")}
          </Button>
        ) : null}

        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
          hidden
          onChange={(event) => {
            void accept(event.target.files?.[0])
            event.target.value = ""
          }}
        />
      </div>

      {problem ? <p className="mt-2 text-[12.5px] text-danger">{t("Settings", problem)}</p> : null}
    </div>
  )
}
