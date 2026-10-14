import type { ConflictPolicy } from "@/api/types"
import { AppIcon } from "@/components/icon/AppIcon"
import { Menu, MenuCheckItem, MenuContent, MenuTrigger } from "@/components/ui/menu"
import { MODAL_MENU_CLASS } from "@/components/ui/modal-menu"
import { tPlural } from "@/i18n/plural"
import { useT } from "@/i18n/useT"

const POLICIES: { value: ConflictPolicy; label: string; caption: string }[] = [
  { value: "KeepBoth", label: "TransferConflictKeepBoth", caption: "TransferConflictKeepBothCaption" },
  { value: "Skip", label: "TransferConflictSkip", caption: "TransferConflictSkipCaption" },
  { value: "Replace", label: "TransferConflictReplace", caption: "TransferConflictReplaceCaption" },
]

export function ImportStatus({
  summary,
  progress,
  collisions,
  policy,
  onPolicy,
  disabled,
}: {
  summary: string
  progress: { done: number; total: number } | null
  collisions: number
  policy: ConflictPolicy
  onPolicy: (policy: ConflictPolicy) => void
  disabled: boolean
}) {
  const t = useT()
  const common = (key: string) => t("Common", key)
  const current = POLICIES.find((option) => option.value === policy) ?? POLICIES[0]

  return (
    <div className="min-w-0 flex-1 text-[11.5px] text-ink-3">
      <div className="flex min-w-0 items-center gap-1">
        <span aria-live="polite" className="truncate">
          {progress
            ? tPlural(t, "Common", IMPORTING, progress.total, { done: progress.done })
            : collisions > 0
              ? tPlural(t, "Common", ALREADY_EXIST, collisions)
              : summary}
        </span>
        {!progress && collisions > 0 ? (
          <>
            <span aria-hidden>·</span>
            <Menu>
              <MenuTrigger asChild disabled={disabled}>
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 font-medium text-ink-2 hover:bg-frame-hover hover:text-ink disabled:opacity-50"
                >
                  {common(current.label)}
                  <AppIcon name="chevron-down" size={12} />
                </button>
              </MenuTrigger>
              <MenuContent className={MODAL_MENU_CLASS}>
                {POLICIES.map((option) => (
                  <MenuCheckItem
                    key={option.value}
                    checked={option.value === policy}
                    description={common(option.caption)}
                    onSelect={() => onPolicy(option.value)}
                  >
                    {common(option.label)}
                  </MenuCheckItem>
                ))}
              </MenuContent>
            </Menu>
          </>
        ) : null}
      </div>
    </div>
  )
}

/** On its own line above the buttons so it can wrap. */
export function ReplaceNote({ text }: { text: string }) {
  return <p className="basis-full text-[11.5px] leading-snug text-danger">{text}</p>
}

const ALREADY_EXIST = { one: "TransferAlreadyExistsOne", many: "TransferAlreadyExistsMany" }
const IMPORTING = { one: "TransferImportingOne", many: "TransferImportingMany" }
