import type { ConflictPolicy } from "@/api/types"
import { AppIcon } from "@/components/icon/AppIcon"
import { Menu, MenuCheckItem, MenuContent, MenuTrigger } from "@/components/ui/menu"
import { MODAL_MENU_CLASS } from "@/components/ui/modal-menu"
import { useT } from "@/i18n/useT"

const POLICIES: { value: ConflictPolicy; label: string; caption: string }[] = [
  { value: "KeepBoth", label: "TransferConflictKeepBoth", caption: "TransferConflictKeepBothCaption" },
  { value: "Skip", label: "TransferConflictSkip", caption: "TransferConflictSkipCaption" },
  { value: "Replace", label: "TransferConflictReplace", caption: "TransferConflictReplaceCaption" },
]

/** The duplicate-name choice. It is a menu rather than a select so each option can show a caption. */
export function ConflictRow({
  policy,
  onPolicy,
  disabled,
  note,
}: {
  policy: ConflictPolicy
  onPolicy: (policy: ConflictPolicy) => void
  disabled: boolean
  /** Shown under the row when the chosen policy deletes something. */
  note?: string | null
}) {
  const t = useT()
  const common = (key: string) => t("Common", key)
  const current = POLICIES.find((option) => option.value === policy) ?? POLICIES[0]

  return (
    <div className="mx-6 shrink-0 border-t border-divider-subtle pt-2.5 pb-3">
      <div className="flex items-center gap-3">
        <span className="flex-1 text-[13px] text-text-secondary">{common("TransferConflictLabel")}</span>
        <Menu>
          <MenuTrigger asChild disabled={disabled}>
            <button
              type="button"
              data-transfer-conflict
              className="inline-flex h-[30px] items-center gap-2 rounded-lg bg-surface px-2 text-[13px] text-text-primary shadow-[0_0_0_1px_var(--line)] hover:bg-frame-hover disabled:opacity-50"
            >
              {common(current.label)}
              <AppIcon name="chevron-down" size={13} />
            </button>
          </MenuTrigger>
          <MenuContent className={MODAL_MENU_CLASS} align="end">
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
      </div>
      {note ? <p className="mt-1.5 text-[12px] leading-snug text-danger">{note}</p> : null}
    </div>
  )
}
