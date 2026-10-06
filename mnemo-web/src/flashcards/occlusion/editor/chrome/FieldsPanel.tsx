import type { CardTypeDto } from "@/api/types"
import { Segmented } from "@/components/ui/segmented"
import { useT } from "@/i18n/useT"

import { TagEditor } from "../../../editor/components/TagEditor"
import type { FactDraft } from "../../../facts/fact-draft"
import {
  OCCLUSION_BACK_FIELD,
  OCCLUSION_FRONT_FIELD,
  OCCLUSION_MASKS_FIELD,
  occlusionFieldTooLong,
  type OcclusionMode,
} from "../../../facts/occlusion"
import type { OcclusionEditor } from "../useOcclusionEditor"
import { CardsList } from "./CardsList"
import type { ActionChords } from "./useActionChords"

export interface FieldsPanelProps {
  type: CardTypeDto
  draft: FactDraft
  editor: OcclusionEditor
  chords: ActionChords
  width: number
  /** The Cards section only shows when there is room for it and there are cards. */
  showCards: boolean
  renaming: string | null
  onRenaming: (maskId: string | null) => void
  onValue: (fieldId: string, value: string) => void
  onTags: (tags: string[]) => void
}

/** The fact's text around the image: Front, how it is studied, the cards, Back and Tags. */
export function FieldsPanel(props: FieldsPanelProps) {
  const { type, draft, editor } = props
  const t = useT()
  const front = type.fields.find((field) => field.id === OCCLUSION_FRONT_FIELD)
  const back = type.fields.find((field) => field.id === OCCLUSION_BACK_FIELD)
  const cards = props.showCards && editor.cards.length > 0

  return (
    <aside
      aria-label={t("Flashcards", "OcclusionPanelLabel")}
      className="flex shrink-0 flex-col gap-4 overflow-y-auto border-l border-line-soft px-5 py-4"
      style={{ width: props.width }}
    >
      {front ? <TextSection field={front} value={draft.values[front.id] ?? ""} onChange={props.onValue} /> : null}

      <section className="flex flex-col gap-1.5">
        <SectionLabel>{t("Flashcards", "OcclusionStudyMode")}</SectionLabel>
        <Segmented<OcclusionMode>
          label={t("Flashcards", "OcclusionStudyMode")}
          value={editor.document.mode}
          onChange={(mode) => editor.store.setMode(mode)}
          options={[
            { value: "hideAll", label: t("Flashcards", "OcclusionHideAll"), detail: t("Flashcards", "OcclusionHideAllDetail") },
            { value: "hideOne", label: t("Flashcards", "OcclusionHideOne"), detail: t("Flashcards", "OcclusionHideOneDetail") },
          ]}
        />
      </section>

      {cards ? (
        <section className="flex min-h-24 flex-1 flex-col gap-1.5">
          <SectionLabel>{t("Flashcards", "OcclusionCardsLabel")}</SectionLabel>
          <CardsList editor={editor} chords={props.chords} renaming={props.renaming} onRenaming={props.onRenaming} />
        </section>
      ) : (
        <div className="flex-1" />
      )}

      {editor.collisions.length > 0 ? (
        <p role="status" className="m-0 rounded-lg bg-danger-wash px-3 py-2 text-[11.5px] text-danger">
          {t("Flashcards", "OcclusionCollisionNotice")}
        </p>
      ) : null}

      {occlusionFieldTooLong(draft.values[OCCLUSION_MASKS_FIELD]) ? (
        <p role="status" className="m-0 rounded-lg bg-danger-wash px-3 py-2 text-[11.5px] text-danger">
          {t("Flashcards", "OcclusionMasksTooLarge")}
        </p>
      ) : null}

      {back ? <TextSection field={back} value={draft.values[back.id] ?? ""} onChange={props.onValue} /> : null}

      {/* Delete on a tag chip removes a tag, not the selected masks. */}
      <div data-no-editor-keys="">
        <TagEditor tags={draft.tags} onChange={props.onTags} />
      </div>
    </aside>
  )
}

function SectionLabel({ children }: { children: string }) {
  return <span className="text-[12px] font-medium tracking-[0.04em] text-ink-3 uppercase">{children}</span>
}

function TextSection({
  field,
  value,
  onChange,
}: {
  field: CardTypeDto["fields"][number]
  value: string
  onChange: (fieldId: string, value: string) => void
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <SectionLabel>{field.name}</SectionLabel>
      <textarea
        aria-label={field.name}
        value={value}
        placeholder={field.hint ?? undefined}
        rows={2}
        onChange={(event) => onChange(field.id, event.target.value)}
        className="w-full resize-none rounded-lg bg-transparent px-3 py-2 text-[13.5px] leading-[1.55] text-ink shadow-[0_0_0_1px_var(--line)] outline-none transition-shadow placeholder:text-ink-3 focus:shadow-[0_0_0_1.5px_var(--solid)]"
      />
    </section>
  )
}
