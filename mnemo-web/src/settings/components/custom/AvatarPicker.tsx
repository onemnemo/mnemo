import { useRef, useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import {
  DEFAULT_PROFILE_PICTURE,
  PROFILE_PICTURES,
  avatarUploadProblem,
  isCustomAvatar,
  uploadAvatar,
} from "../../assets"
import { useSettingsStore, useSettingValue } from "../../store"
import { useAvatarUrl } from "../../useAvatarUrl"
import { Block } from "../kit"

const TILE = 56

/**
 * The profile picture: the bundled set, plus whatever the user brought.
 *
 * One component for settings and for first-run setup. Onboarding that teaches a control
 * the user will never see again has taught them nothing, and two implementations of a
 * picker drift the moment one of them gains a feature.
 *
 * An uploaded picture takes its place in the same strip rather than replacing it, so
 * going back to a bundled avatar is a click on the avatar you want instead of a Remove
 * button that has to invent what to fall back to.
 */
export function AvatarPicker({
  title,
  description,
  divider,
}: {
  title: string
  description?: string
  divider: boolean
}) {
  const t = useT()
  const selected = useSettingValue("User.ProfilePicture", DEFAULT_PROFILE_PICTURE)
  const setValue = useSettingsStore((s) => s.setValue)

  const fileInput = useRef<HTMLInputElement>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const options = isCustomAvatar(selected) ? [...PROFILE_PICTURES, selected] : PROFILE_PICTURES

  async function accept(file: File | undefined) {
    if (!file) return

    const rejection = avatarUploadProblem(file)
    if (rejection !== null) {
      setProblem(rejection)
      return
    }

    setProblem(null)
    setUploading(true)
    try {
      await setValue("User.ProfilePicture", await uploadAvatar(file))
    } catch {
      setProblem("AvatarUploadFailed")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className={cn(divider && "border-b border-line-soft")}>
      <Block label={title} description={description}>
        <div className="flex flex-wrap items-center gap-2.5">
          {options.map((option, index) => (
            <Tile
              key={option}
              stored={option}
              label={
                isCustomAvatar(option)
                  ? t("Settings", "AvatarCustom")
                  : t("Settings", "AvatarOptionFormat", { 0: index + 1 })
              }
              selected={option === selected}
              onSelect={() => void setValue("User.ProfilePicture", option)}
            />
          ))}

          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
            aria-label={t("Settings", "AvatarUpload")}
            title={t("Settings", "AvatarUpload")}
            style={{ width: TILE, height: TILE }}
            className={cn(
              "grid place-items-center rounded-full text-ink-3 transition-shadow",
              "shadow-[0_0_0_1px_var(--line-soft)] hover:text-ink-2 hover:shadow-[0_0_0_1px_var(--line)]",
              "disabled:pointer-events-none disabled:opacity-45",
            )}
          >
            <AppIcon name={uploading ? "loader-circle" : "image-plus"} size={17} strokeWidth={1.7} className={cn(uploading && "animate-spin")} />
          </button>

          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
            hidden
            onChange={(e) => {
              void accept(e.target.files?.[0])
              // Cleared so picking the same file twice in a row still fires a change.
              e.target.value = ""
            }}
          />
        </div>

        {problem !== null && <p className="mt-2.5 text-[12.5px] text-danger">{t("Settings", problem)}</p>}
      </Block>
    </div>
  )
}

function Tile({
  stored,
  label,
  selected,
  onSelect,
}: {
  stored: string
  label: string
  selected: boolean
  onSelect: () => void
}) {
  const url = useAvatarUrl(stored)

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={label}
      style={{ width: TILE, height: TILE }}
      className={cn(
        "relative overflow-hidden rounded-full bg-canvas-sunken transition-shadow",
        // Selection reads as contrast, the way the buttons and the theme cards do. The
        // second ring is the gap that keeps the first off the artwork.
        selected
          ? "shadow-[0_0_0_1.5px_var(--solid),0_0_0_4px_var(--canvas)]"
          : "shadow-[0_0_0_1px_var(--line-soft)] hover:shadow-[0_0_0_1px_var(--line)]",
      )}
    >
      {url !== null && <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />}
      {selected && (
        <span className="absolute bottom-0.5 right-0.5 flex size-[15px] items-center justify-center rounded-full bg-solid">
          <AppIcon name="check" size={9} strokeWidth={3} className="text-solid-fg" />
        </span>
      )}
    </button>
  )
}
