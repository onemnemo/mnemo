import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"

import type { CardTypeDraft, CardTypeFieldDraft, CardTypeLayoutDraft } from "../card-types"
import { problems } from "../card-types"
import { CardTypeCards } from "./CardTypeCards"
import { CardTypeFields } from "./CardTypeFields"

/** The pane for the selected card type: what it is called, what it asks for, what it makes. */
export function CardTypeDetails({
  draft,
  onRename,
  onPatchField,
  onMoveField,
  onRemoveField,
  onSetSortField,
  onAddField,
  onPatchLayout,
  onRemoveLayout,
  onAddLayout,
}: {
  draft: CardTypeDraft
  onRename: (name: string) => void
  onPatchField: (fieldId: string, patch: Partial<CardTypeFieldDraft>) => void
  onMoveField: (fieldId: string, delta: number) => void
  onRemoveField: (fieldId: string) => void
  onSetSortField: (fieldId: string) => void
  onAddField: () => void
  onPatchLayout: (layoutId: string, patch: Partial<CardTypeLayoutDraft>) => void
  onRemoveLayout: (layoutId: string) => void
  onAddLayout: () => void
}) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)

  const found = problems(draft)
  const generatedFrom = draft.generator
    ? draft.fields.find((field) => field.id === (draft.generateFrom ?? draft.sortFieldId))
    : undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
      <label className="flex items-center gap-3">
        <span className="w-[92px] shrink-0 text-[12.5px] text-ink-2">{fc("CardTypesNameLabel")}</span>
        <input
          value={draft.name}
          onChange={(event) => onRename(event.target.value)}
          aria-label={fc("CardTypesNameLabel")}
          className="h-8 min-w-0 flex-1 rounded-lg bg-transparent px-2.5 text-[13px] text-ink shadow-[0_0_0_1px_var(--line)] outline-none focus:shadow-[0_0_0_1.5px_var(--solid)]"
        />
      </label>

      {draft.isBuiltIn ? (
        <p className="text-[11.5px] text-ink-3">{fc("CardTypesBuiltInNote")}</p>
      ) : null}

      <CardTypeFields
        draft={draft}
        onPatchField={onPatchField}
        onMoveField={onMoveField}
        onRemoveField={onRemoveField}
        onSetSortField={onSetSortField}
        onAddField={onAddField}
      />

      {/* A generated type decides its own cards from what is written in one field, so there is
          nothing here to lay out and saying so beats an empty section. */}
      {draft.generator ? (
        <p className="rounded-lg bg-canvas-sunken px-3 py-2.5 text-[12.5px] leading-[17px] text-ink-2">
          {fc("CardTypesGeneratedFormat", { 0: generatedFrom?.name ?? "" })}
        </p>
      ) : (
        <CardTypeCards
          draft={draft}
          onPatchLayout={onPatchLayout}
          onRemoveLayout={onRemoveLayout}
          onAddLayout={onAddLayout}
        />
      )}

      {found.length > 0 ? (
        <ul className="space-y-1">
          {found.map((problem) => (
            <li key={problem} className="flex items-center gap-1.5 text-[12px] text-danger">
              <AppIcon name="circle-alert" size={13} />
              <span>{fc(problem)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
