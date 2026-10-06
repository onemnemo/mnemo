import { useEffect, useRef, useState } from "react"
import { Dialog } from "radix-ui"

import type { CardTypeDto } from "@/api/types"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useT } from "@/i18n/useT"
import { isEditableTarget } from "@/keybinds/chord"

import { useCardAsset } from "../../../editor/assets"
import { EditorFooter } from "../../../editor/components/EditorFooter"
import { IMAGE_ACCEPT } from "../../../editor/editor-state"
import { FactEditorHeader, type FactEditorHeaderProps } from "../../../facts/components/FactEditorHeader"
import type { CardLoss, FactDraft } from "../../../facts/fact-draft"
import { OCCLUSION_IMAGE_FIELD, OCCLUSION_MASKS_FIELD } from "../../../facts/occlusion"
import { useElementSize } from "../../hooks"
import { CardsList } from "./CardsList"
import { EmptyDropZone } from "./EmptyDropZone"
import { FieldsPanel } from "./FieldsPanel"
import { FooterChip } from "./FooterChip"
import { ImageArea } from "./ImageArea"
import { MoreMenu } from "./MoreMenu"
import { useActionChords } from "./useActionChords"
import { useImageIntake } from "./useImageIntake"
import { useOcclusionDraft } from "./useOcclusionDraft"
import { useOcclusionKeys } from "./useOcclusionKeys"
import { useRestoreFocus } from "./useRestoreFocus"

/** Below this width the tool bar moves left and the Cards list moves to the footer. */
const SMALL_WIDTH = 1000
/** Below this height the Cards list moves to the footer, since the panel would leave it no room. */
const SMALL_HEIGHT = 520
/** From this width the side panel is 312px rather than 288px. */
const WIDE_PANEL_FROM = 1100

export interface OcclusionLayoutProps {
  header: Omit<FactEditorHeaderProps, "children" | "className">
  type: CardTypeDto
  draft: FactDraft
  loss: CardLoss
  isEditMode: boolean
  sessionAdded: number
  canSave: boolean
  saving: boolean
  onValue: (fieldId: string, value: string) => void
  onTags: (tags: string[]) => void
  /** Sets the one image of the fact, replacing any that is there. */
  onImage: (file: File) => void
  onSave: () => void
  onClose: () => void
}

/** The image occlusion form: a large modal that fills the window minus a margin. */
export function OcclusionLayout(props: OcclusionLayoutProps) {
  const { type, draft, loss } = props
  const t = useT()
  const content = useRef<HTMLDivElement>(null)
  useRestoreFocus(content)

  // The save handler of the latest render, for a save that has to wait for a rename to land first.
  const save = useRef(props.onSave)
  save.current = props.onSave
  const box = useElementSize(content)
  const small = box.w < SMALL_WIDTH || box.h < SMALL_HEIGHT

  const [renaming, setRenaming] = useState<string | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const listOpenRef = useRef(listOpen)
  listOpenRef.current = listOpen
  const renameTimer = useRef(0)
  useEffect(() => () => window.clearTimeout(renameTimer.current), [])
  const chords = useActionChords()
  const editor = useOcclusionDraft(
    draft.values[OCCLUSION_MASKS_FIELD] ?? "",
    (value) => props.onValue(OCCLUSION_MASKS_FIELD, value),
    (maskId) => {
      if (!small || listOpenRef.current) return setRenaming(maskId)
      // The field takes focus as it mounts, which the modal's focus trap pulls straight back unless
      // the list's popover is already up and has paused it.
      setListOpen(true)
      window.clearTimeout(renameTimer.current)
      renameTimer.current = window.setTimeout(() => setRenaming(maskId), 0)
    },
  )
  const onKeyDown = useOcclusionKeys(editor)

  const image = draft.media[OCCLUSION_IMAGE_FIELD]?.[0]
  const imageAsset = useCardAsset(image?.assetId)
  const intake = useImageIntake(props.onImage)
  const count = image ? editor.cards.length : 0

  const list = (
    <div data-editor-keys="" className="flex min-h-0 flex-1 flex-col">
      <CardsList editor={editor} chords={chords} renaming={renaming} onRenaming={setRenaming} />
    </div>
  )
  const chip = small ? (
    <Popover open={listOpen} onOpenChange={setListOpen}>
      <PopoverTrigger asChild>
        <FooterChip count={count} removed={loss.removed.length} expandable disabled={count === 0 || props.saving} />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="flex max-h-[min(360px,60vh)] w-[300px] flex-col p-1.5"
        onOpenAutoFocus={(event) => {
          if (renaming) event.preventDefault()
        }}
        // The same Escape that cancels a rename must not also close the list.
        onEscapeKeyDown={(event) => {
          if (renaming) event.preventDefault()
        }}
      >
        {list}
      </PopoverContent>
    </Popover>
  ) : (
    <FooterChip count={count} removed={loss.removed.length} expandable={false} />
  )

  return (
    <Dialog.Content
      ref={content}
      aria-describedby={undefined}
      data-occlusion-editor=""
      className="fixed left-1/2 top-1/2 z-50 flex h-[calc(100vh-3rem)] w-[calc(100vw-3rem)] max-w-[1800px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-line-soft bg-canvas shadow-pop focus:outline-none"
      // The first focus is the editor itself, not the first control, so the keys work straight away.
      onOpenAutoFocus={(event) => {
        event.preventDefault()
        content.current?.focus()
      }}
      onEscapeKeyDown={(event) => {
        // An armed tool or a shape in progress goes first, then the selection, and only then the editor.
        if (document.activeElement?.closest("[data-inline-editor]")) return event.preventDefault()
        if (!isEditableTarget(event.target) && editor.perform("cancel")) event.preventDefault()
      }}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault()
          // A rename in progress commits as this event bubbles, and the draft it writes only exists
          // after the next render.
          if ((event.target as Element).closest("[data-inline-editor]")) window.setTimeout(() => save.current(), 0)
          else props.onSave()
          return
        }
        if (!props.saving) onKeyDown(event)
      }}
      onPaste={(event) => {
        if (!props.saving && !image && !isEditableTarget(event.target)) intake.onPaste(event)
      }}
    >
      {/* A save sends the draft as it was, so nothing can change under it until the answer is back. */}
      <div className="contents" inert={props.saving}>
        <FactEditorHeader {...props.header} className="h-[52px] shrink-0 pr-3 pl-5">
          {image ? <MoreMenu onReplaceImage={intake.openPicker} /> : null}
        </FactEditorHeader>
      </div>

      <div className="flex min-h-0 flex-1" inert={props.saving}>
        <section aria-label={t("Flashcards", "OcclusionImageArea")} className="relative min-w-0 flex-1 bg-canvas-sunken">
          {image ? (
            <ImageArea
              editor={editor}
              imageUrl={imageAsset.url}
              imageFailed={imageAsset.failed}
              chords={chords}
              compact={box.w < SMALL_WIDTH}
            />
          ) : (
            <EmptyDropZone onChoose={intake.openPicker} onDragOver={intake.onDragOver} onDrop={intake.onDrop} />
          )}
        </section>
        <FieldsPanel
          type={type}
          draft={draft}
          editor={editor}
          chords={chords}
          width={box.w < WIDE_PANEL_FROM ? 288 : 312}
          showCards={Boolean(image) && !small}
          renaming={renaming}
          onRenaming={setRenaming}
          onValue={props.onValue}
          onTags={props.onTags}
        />
      </div>

      <EditorFooter
        isEditMode={props.isEditMode}
        sessionAdded={props.sessionAdded}
        canSave={props.canSave}
        saving={props.saving}
        onClose={props.onClose}
        onSave={props.onSave}
        leading={chip}
      />

      <input
        ref={intake.picker}
        type="file"
        accept={IMAGE_ACCEPT}
        className="hidden"
        aria-label={t("Flashcards", "OcclusionChooseImage")}
        onChange={(event) => {
          intake.onPick(event.target.files)
          // Reset so picking the same file twice in a row still fires a change event.
          event.target.value = ""
        }}
      />
    </Dialog.Content>
  )
}
