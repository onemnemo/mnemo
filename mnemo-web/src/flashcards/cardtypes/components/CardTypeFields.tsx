import { AppIcon } from "@/components/icon/AppIcon"
import { IconButton } from "@/components/ui/icon-button"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import type { CardTypeDraft, CardTypeFieldDraft } from "../card-types"

/**
 * The fields a card type asks for, in the order the editor asks for them. The sort field is picked
 * here too, since it is a property of one of these rows rather than of the type as a whole.
 */
export function CardTypeFields({
  draft,
  onPatchField,
  onMoveField,
  onRemoveField,
  onSetSortField,
  onAddField,
}: {
  draft: CardTypeDraft
  onPatchField: (fieldId: string, patch: Partial<CardTypeFieldDraft>) => void
  onMoveField: (fieldId: string, delta: number) => void
  onRemoveField: (fieldId: string) => void
  onSetSortField: (fieldId: string) => void
  onAddField: () => void
}) {
  const t = useT()
  const fc = (key: string) => t("Flashcards", key)

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-[12px] font-medium uppercase tracking-[0.04em] text-ink-3">{fc("CardTypesFieldsLabel")}</h3>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onAddField}
          className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-ink-3 transition-colors hover:bg-frame-hover hover:text-ink"
        >
          <AppIcon name="common/plus" size={12} />
          <span>{fc("CardTypesAddField")}</span>
        </button>
      </div>

      <div className="space-y-1.5">
        {draft.fields.map((field, index) => (
          <div key={field.id} className="flex items-center gap-1.5">
            <input
              value={field.name}
              onChange={(event) => onPatchField(field.id, { name: event.target.value })}
              placeholder={fc("CardTypesFieldNamePlaceholder")}
              aria-label={fc("CardTypesFieldNamePlaceholder")}
              className="h-8 w-[168px] shrink-0 rounded-lg bg-transparent px-2.5 text-[13px] text-ink shadow-[0_0_0_1px_var(--line)] outline-none placeholder:text-ink-3 focus:shadow-[0_0_0_1.5px_var(--solid)]"
            />
            <input
              value={field.hint}
              onChange={(event) => onPatchField(field.id, { hint: event.target.value })}
              placeholder={fc("CardTypesFieldHintPlaceholder")}
              aria-label={fc("CardTypesFieldHintPlaceholder")}
              className="h-8 min-w-0 flex-1 rounded-lg bg-transparent px-2.5 text-[13px] text-ink shadow-[0_0_0_1px_var(--line)] outline-none placeholder:text-ink-3 focus:shadow-[0_0_0_1.5px_var(--solid)]"
            />

            {/* The sort field decides what a row in the collection shows for a piece of material,
                so it is one of these fields rather than a setting somewhere else. */}
            <button
              type="button"
              onClick={() => onSetSortField(field.id)}
              aria-pressed={draft.sortFieldId === field.id}
              title={fc("CardTypesSortField")}
              aria-label={fc("CardTypesSortField")}
              className={cn(
                "grid size-8 shrink-0 place-items-center rounded-lg transition-colors",
                draft.sortFieldId === field.id
                  ? "bg-frame-active text-ink"
                  : "text-ink-3 hover:bg-frame-hover hover:text-ink",
              )}
            >
              <AppIcon name="list" size={14} />
            </button>

            <IconButton
              icon="arrow-up"
              iconSize={13}
              label={fc("CardTypesMoveUp")}
              disabled={index === 0}
              onClick={() => onMoveField(field.id, -1)}
            />
            <IconButton
              icon="arrow-down"
              iconSize={13}
              label={fc("CardTypesMoveDown")}
              disabled={index === draft.fields.length - 1}
              onClick={() => onMoveField(field.id, 1)}
            />
            <IconButton
              icon="common/trash"
              iconSize={13}
              label={fc("CardTypesRemoveField")}
              disabled={draft.fields.length === 1}
              onClick={() => onRemoveField(field.id)}
            />
          </div>
        ))}
      </div>
    </section>
  )
}
