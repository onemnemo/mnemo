import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { useI18nStore } from "@/i18n/store"
import { useT } from "@/i18n/useT"
import type { ProofingLanguage } from "@/notes/proofing/types"

import { describeState, labelOf, pickerGroups } from "./proofing-languages"

const NS = "Settings"

/**
 * The languages that can be switched on.
 *
 * Nothing is downloaded here, so the second group is not a shelf: it is the
 * catalogue's own record of the languages this build knows about and cannot
 * check, stated so nobody hunts for a button that does not exist.
 */
export function ProofingLanguagePicker({
  onClose,
  languages,
  active,
  onAdd,
}: {
  onClose: () => void
  languages: readonly ProofingLanguage[]
  active: readonly string[]
  onAdd: (id: string) => void
}) {
  const t = useT()
  const st = (key: string, params?: Record<string, string | number>) => t(NS, key, params)
  const bundle = useI18nStore((state) => state.bundle)
  const shipped = (key: string) => bundle[NS]?.[key] !== undefined

  const groups = pickerGroups(languages, active)

  return (
    <Modal
      open
      onClose={onClose}
      title={st("ProofingAddLanguage")}
      closeLabel={t("Common", "Close")}
      width={520}
    >
      <div className="scroll-thin flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-5 pb-5">
        {groups.installed.length > 0 && (
          <section>
            <p className="pt-2 pb-0.5 text-[12.5px] font-medium text-ink-3">{st("ProofingPickerInstalled")}</p>
            <div className="[&>*+*]:border-t [&>*+*]:border-line-soft">
              {groups.installed.map((entry) => (
                <div key={entry.language.id} className="flex items-center gap-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] text-ink">{labelOf(entry.language, languages)}</p>
                    <p className="mt-0.5 text-[12px] text-ink-3">{describeState(entry.language, st, shipped)}</p>
                  </div>
                  {entry.active ? (
                    <span className="flex shrink-0 items-center gap-1.5 text-[12.5px] text-ink-3">
                      <AppIcon name="check" size={14} strokeWidth={2} />
                      {st("ProofingPickerAdded")}
                    </span>
                  ) : (
                    <Button
                      variant="outline"
                      className="shrink-0"
                      aria-label={st("ProofingPickerAddFormat", { 0: labelOf(entry.language, languages) })}
                      onClick={() => onAdd(entry.language.id)}
                    >
                      {st("ProofingPickerAdd")}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {groups.unavailable.length > 0 && (
          <section>
            <p className="pt-4 pb-0.5 text-[12.5px] font-medium text-ink-3">{st("ProofingPickerUnavailable")}</p>
            <div className="[&>*+*]:border-t [&>*+*]:border-line-soft">
              {groups.unavailable.map((language) => (
                <div key={language.id} className="py-2.5">
                  <p className="truncate text-[13.5px] text-ink">{labelOf(language, languages)}</p>
                  <p className="mt-0.5 text-[12px] text-ink-3">{describeState(language, st, shipped)}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </Modal>
  )
}
