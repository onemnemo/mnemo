import { useEffect, useMemo, useRef, useState } from "react"
import { Dialog } from "radix-ui"

import { onDirtyCheck } from "@/app/shutdown"
import { IconButton } from "@/components/ui/icon-button"
import { useT } from "@/i18n/useT"
import { SelectControl } from "@/settings/components/controls/SelectControl"
import { dialog } from "@/stores/dialog"
import { toast } from "@/stores/toast"

import { useDecksQuery, useFoldersQuery } from "../api"
import { uploadCardAsset } from "../editor/assets"
import { EditorFooter } from "../editor/components/EditorFooter"
import { TagEditor } from "../editor/components/TagEditor"
import { deckOptions } from "../editor/deck-options"
import { draftFromUpload, type DraftAttachment } from "../editor/draft"
import { MAX_ATTACHMENTS_PER_SIDE } from "../editor/editor-state"
import type { CardEditorTarget } from "../editor/store"
import { saveFact, useCardTypesQuery, useFactForCardQuery, useRefreshAfterFactWrite } from "./api"
import { CardCountBar } from "./components/CardCountBar"
import { FieldEditor } from "./components/FieldEditor"
import {
  canSaveFact,
  draftFromFact,
  droppedCardCount,
  emptyDraft,
  factDraftIsDirty,
  resolveDraftDeck,
  retypeDraft,
  snapshotFactDraft,
  toSaveFact,
  type FactDraft,
} from "./fact-draft"
import { CLOZE_GENERATOR } from "./generation"

/** Id of the type a new piece of material starts on when nothing else says otherwise. */
const DEFAULT_TYPE_ID = "basic"

export function FactEditor({ target, onClose }: { target: CardEditorTarget; onClose: () => void }) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)

  const isEditMode = target.kind === "edit"
  const decks = useDecksQuery()
  const folders = useFoldersQuery()
  const types = useCardTypesQuery()
  const fact = useFactForCardQuery(isEditMode ? target.cardId : null)
  const refresh = useRefreshAfterFactWrite()

  const [draft, setDraft] = useState<FactDraft>(() => emptyDraft(target.deckId, DEFAULT_TYPE_ID))
  const [focusedField, setFocusedField] = useState<string | null>(null)
  const [sessionAdded, setSessionAdded] = useState(0)
  const [saving, setSaving] = useState(false)
  // Bumped to ask the first field for focus; a counter rather than a boolean so the same request
  // can be made again for the next piece of material in a run.
  const [focusFirst, setFocusFirst] = useState(0)

  // Hydrate once the material arrives, guarded to a single run: the query object gets a new
  // identity on every refetch, and a background refetch must not overwrite what has been typed.
  const loaded = fact.data
  const hydrated = useRef<string | null>(null)
  // The draft this started from. An add form starts empty, an edit form starts at whatever
  // hydrates in; closing without moving away from that is not losing anything.
  const baseline = useRef(snapshotFactDraft(emptyDraft(target.deckId, DEFAULT_TYPE_ID)))
  useEffect(() => {
    if (!loaded || hydrated.current === loaded.id) return
    hydrated.current = loaded.id
    const next = draftFromFact(loaded)
    setDraft(next)
    baseline.current = snapshotFactDraft(next)
  }, [loaded])

  // Material that cannot be loaded has nothing to edit, and the page behind this dialog is already
  // the right place to be.
  useEffect(() => {
    if (fact.isError) onClose()
  }, [fact.isError, onClose])

  // Read current state through a ref without re-registering on every edit.
  const latestDraft = useRef(draft)
  latestDraft.current = draft
  useEffect(
    () => onDirtyCheck(() => factDraftIsDirty(baseline.current, snapshotFactDraft(latestDraft.current))),
    [],
  )

  const options = useMemo(() => deckOptions(decks.data ?? [], folders.data ?? []), [decks.data, folders.data])
  const deckId = resolveDraftDeck(draft.deckId, options.map((option) => option.id), target.deckId)
  const typeList = useMemo(() => (types.data ?? []).map((summary) => summary.type), [types.data])
  const type = typeList.find((candidate) => candidate.id === draft.typeId)

  // The type list arrives after the first paint, and a collection whose types were renamed or
  // reordered may not hold the default at all, so the draft settles onto a real one once it can.
  useEffect(() => {
    if (isEditMode || typeList.length === 0) return
    setDraft((current) =>
      typeList.some((candidate) => candidate.id === current.typeId)
        ? current
        : { ...current, typeId: typeList[0].id },
    )
  }, [isEditMode, typeList])

  // Bumped whenever the draft is replaced wholesale. An upload started against the previous piece
  // of material must not land in the next one, which is reachable in add mode: attach an image,
  // hit the save shortcut, and the response arrives after the form has already been cleared.
  const draftGeneration = useRef(0)

  const setValue = (fieldId: string, value: string) =>
    setDraft((current) => ({ ...current, values: { ...current.values, [fieldId]: value } }))

  const attachFiles = async (fieldId: string, files: File[]) => {
    // Trimmed up front so a batch drop does not upload files it has no room for; the real cap is
    // enforced in the state updater below, where concurrent drops cannot race past it.
    const room = MAX_ATTACHMENTS_PER_SIDE - (draft.media[fieldId]?.length ?? 0)
    // Read once for the whole batch. Re-reading per file would let every upload after the first
    // adopt the new generation and land on the material the save just started.
    const generation = draftGeneration.current
    for (const file of files.slice(0, Math.max(0, room))) {
      try {
        const asset = await uploadCardAsset(file)
        // Stop rather than skip, so the rest of the batch is not uploaded just to be dropped.
        if (generation !== draftGeneration.current) return
        setDraft((current) => {
          const existing: DraftAttachment[] = current.media[fieldId] ?? []
          if (existing.length >= MAX_ATTACHMENTS_PER_SIDE) return current
          // The side on a draft attachment is a placeholder: a layout decides which side of which
          // card the field lands on, and the server rewrites it per card.
          const next = [...existing, draftFromUpload(asset, "front")]
          return { ...current, media: { ...current.media, [fieldId]: next } }
        })
      } catch {
        // A rejected upload (wrong format, too large) drops the file silently, matching the
        // desktop's own catch-and-carry-on around its picker.
      }
    }
  }

  const removeAttachment = (fieldId: string, key: string) =>
    setDraft((current) => ({
      ...current,
      media: {
        ...current.media,
        [fieldId]: (current.media[fieldId] ?? []).filter((attachment) => attachment.key !== key),
      },
    }))

  // A field id belongs to the type that declared it, so changing type has to move the material onto
  // the new type's fields rather than leave it pointing at fields nothing will render.
  const changeType = (typeId: string) => {
    const next = typeList.find((candidate) => candidate.id === typeId)
    if (!next) return
    setDraft((current) => {
      const previous = typeList.find((candidate) => candidate.id === current.typeId)
      return retypeDraft(current, previous, next)
    })
  }

  const canSave = canSaveFact(type, draft)

  /**
   * Cards are matched to the layout that makes them by key, so a type whose layouts key differently
   * leaves the old cards with nothing producing them and the server deletes them outright, review
   * history included. It is the only thing the editor can do that loses history, so it stops here
   * rather than reporting it afterwards. Counted against what is on disk, not against the type that
   * was picked, so an edit made after the change is accounted for.
   */
  const confirmTypeChange = async (): Promise<boolean> => {
    if (!loaded || !type || draft.typeId === loaded.typeId) return true

    const previous = typeList.find((candidate) => candidate.id === loaded.typeId)
    if (!previous) return true

    const dropped = droppedCardCount(
      { type: previous, draft: draftFromFact(loaded) },
      { type, draft: { ...draft, deckId } },
    )
    if (dropped === 0) return true

    return dialog.confirm({
      title: fc("CardTypeChangeTitle"),
      message: fc("CardTypeChangeMessage", { 0: dropped }),
      confirmLabel: fc("CardTypeChangeConfirm"),
      cancelLabel: t("Common", "Cancel"),
      destructive: true,
    })
  }

  const save = async () => {
    if (!canSave || saving) return
    if (!(await confirmTypeChange())) return
    setSaving(true)
    try {
      await saveFact(toSaveFact(isEditMode ? (loaded?.id ?? null) : null, { ...draft, deckId }))
      refresh()
    } catch (error) {
      // The dialog deliberately stays open so nothing typed is lost, as on the desktop.
      toast.warning(fc("CardEditorSaveErrorTitle"), {
        description: error instanceof Error ? error.message : undefined,
      })
      return
    } finally {
      setSaving(false)
    }

    if (isEditMode) {
      onClose()
      return
    }

    // Add mode saves and stays open. Deck, card type and tags carry to the next piece of material,
    // since they are usually the same for a run, while the fields and their images start clean.
    draftGeneration.current += 1
    setSessionAdded((count) => count + 1)
    setDraft((current) => ({ ...current, values: {}, media: {} }))
    baseline.current = snapshotFactDraft({ ...draft, values: {}, media: {} })
    // Focus goes back to the first field so a run can be typed without reaching for the mouse.
    setFocusFirst((signal) => signal + 1)
  }

  // The single funnel every dismiss path goes through: Escape, a backdrop or outside click, the
  // header close button, and the footer's Close button all end up here. Typed content that has not
  // been saved is confirmed rather than silently dropped.
  const requestClose = async () => {
    if (factDraftIsDirty(baseline.current, snapshotFactDraft(draft))) {
      const discard = await dialog.confirm({
        title: fc("CardEditorDiscardTitle"),
        message: fc("CardEditorDiscardMessage"),
        confirmLabel: fc("CardEditorDiscardConfirm"),
        cancelLabel: t("Common", "Cancel"),
        destructive: true,
      })
      if (!discard) return
    }
    onClose()
  }

  const sourceFieldId = type ? (type.generateFrom || type.sortFieldId) : ""

  return (
    <Dialog.Root open onOpenChange={(next) => { if (!next) void requestClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => {
            // Radix watches for Escape in the capture phase on the document, so an inner field
            // cannot stop the event from reaching it. The dialog declines the dismiss instead, and
            // the field's own handler still runs as the event bubbles down to it.
            if (document.activeElement?.closest("[data-inline-editor]")) event.preventDefault()
          }}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault()
              void save()
            }
          }}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[86vh] w-[724px] max-w-[calc(100vw-3rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-line-soft bg-canvas shadow-pop focus:outline-none"
        >
          <div className="flex items-center gap-3.5 border-b border-line-soft px-5 py-3.5">
            <Dialog.Title className="text-[14px] font-semibold text-ink">
              {fc(isEditMode ? "CardEditorTitleEdit" : "CardEditorTitleNew")}
            </Dialog.Title>
            <SelectControl
              value={deckId}
              choices={options.map((option) => ({ value: option.id, label: option.pathLabel }))}
              onChange={(deckId) => setDraft((current) => ({ ...current, deckId }))}
              label={fc("ColDeck")}
              className="min-w-[180px]"
            />
            <div className="flex-1" />
            <SelectControl
              value={draft.typeId}
              choices={typeList.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
              onChange={changeType}
              label={fc("CardTypeLabel")}
              className="min-w-[150px]"
            />
            <Dialog.Close asChild>
              <IconButton icon="common/x" iconSize={14} label={t("Common", "Close")} />
            </Dialog.Close>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4">
            {(type?.fields ?? []).map((field, index) => (
              <FieldEditor
                key={field.id}
                field={field}
                value={draft.values[field.id] ?? ""}
                isCloze={type?.generator === CLOZE_GENERATOR && field.id === sourceFieldId}
                focused={focusedField === field.id}
                focusSignal={index === 0 ? focusFirst : undefined}
                rows={index === 0 ? 3 : 2}
                attachments={draft.media[field.id] ?? []}
                onChange={(value) => setValue(field.id, value)}
                onFocus={() => setFocusedField(field.id)}
                onAttachFiles={(fieldId, files) => void attachFiles(fieldId, files)}
                onRemoveAttachment={removeAttachment}
              />
            ))}

            <CardCountBar type={type} draft={draft} />

            <p className="text-[11.5px] text-ink-3">{fc("FactAttachmentsHint")}</p>

            <TagEditor tags={draft.tags} onChange={(tags) => setDraft((current) => ({ ...current, tags }))} />
          </div>

          <EditorFooter
            isEditMode={isEditMode}
            sessionAdded={sessionAdded}
            canSave={canSave}
            saving={saving}
            onClose={() => void requestClose()}
            onSave={() => void save()}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
