import { useT } from "@/i18n/useT"
import { useMotionStore, type MotionPreference } from "@/stores/motion"

import { SelectControl } from "../controls/SelectControl"
import { SettingRowShell } from "../SettingRowShell"

/**
 * How much the app animates.
 *
 * Not a toggle, because "follow the system" is a real answer and the most common one:
 * a machine already configured to reduce motion should not need the setting touched,
 * and a two-state control cannot say that is what is happening. The options read as
 * three choices for the same reason.
 */
export function ReduceMotionRow({
  title,
  description,
  divider,
}: {
  title: string
  description?: string
  divider: boolean
}) {
  const t = useT()
  const preference = useMotionStore((s) => s.preference)
  const set = useMotionStore((s) => s.set)

  const choices: { value: MotionPreference; label: string }[] = [
    { value: "system", label: t("Settings", "MotionSystem") },
    { value: "full", label: t("Settings", "MotionFull") },
    { value: "reduced", label: t("Settings", "MotionReduced") },
  ]

  return (
    <SettingRowShell title={title} description={description} divider={divider}>
      <SelectControl
        label={title}
        value={preference}
        choices={choices}
        onChange={(next) => set(next as MotionPreference)}
      />
    </SettingRowShell>
  )
}
