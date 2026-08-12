import { useEffect, useRef } from "react"

import { useT } from "@/i18n/useT"
import { AvatarPicker } from "@/settings/components/custom/AvatarPicker"

import { Head } from "./kit"

/**
 * Name and picture.
 *
 * The name is the one answer here not written through on every keystroke: half a typed
 * word is not a name, so it commits when the step is left. The picture is the settings
 * control unmodified, and writes as it is clicked like everything else.
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

  useEffect(() => field.current?.focus(), [])

  return (
    <>
      <Head title={t("Onboarding", "YouTitle")} body={t("Onboarding", "YouBody")} />

      <div className="mt-8">
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

      <div className="mt-2">
        <AvatarPicker title={t("Onboarding", "YouAvatar")} description={t("Onboarding", "YouAvatarNote")} divider={false} />
      </div>
    </>
  )
}
