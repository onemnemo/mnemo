import { useEffect, useMemo, useRef, useState } from "react"
import { Dialog } from "radix-ui"

import { describeError } from "@/api/error-copy"
import { onDirtyCheck } from "@/app/shutdown"
import { useT } from "@/i18n/useT"
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
import { removalMessage } from "../occlusion/editor/chrome/removal"
import { OcclusionLayout } from "../occlusion/editor/chrome/OcclusionLayout"
import { useDiscardGuard } from "../useDiscardGuard"
import { saveFact, useCardTypesQuery, useFactForCardQuery, useRefreshAfterFactWrite } from "./api"
import { CardCountBar } from "./components/CardCountBar"
import { FactEditorHeader } from "./components/FactEditorHeader"
import { FieldEditor } from "./components/FieldEditor"
import {
  cardLoss,
  canSaveFact,
  draftFromFact,
  emptyDraft,
  factDraftIsDirty,
  resolveDraftDeck,
  restoreOcclusion,
  retypeDraft,
  snapshotFactDraft,
  stashOcclusion,
  toSaveFact,
  type FactDraft,
  type OcclusionStash,
} from "./fact-draft"
import { CLOZE_GENERATOR, OCCLUSION_GENERATOR } from "./generation"
import { OCCLUSION_IMAGE_FIELD, OCCLUSION_MASKS_FIELD, parseOcclusion, serializeOcclusion } from "./occlusion"

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
  // An edit form shows nothing until the material and the type list are in, so the classic dialog
  // never flashes up for a fact that opens in the occlusion editor.
  const [hydratedOnce, setHydratedOnce] = useState(!isEditMode)

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
    setHydratedOnce(true)
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
  // The picture and masks an occlusion draft left behind when it moved to another type, so moving
  // back before saving gives them back instead of an empty editor.
  const stash = useRef<OcclusionStash | null>(null)

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

  // The image occlusion form holds exactly one picture, so a new one replaces whatever is there.
  const uploadingImage = useRef(false)
  const setImage = async (file: File) => {
    // A second pick while one is in flight would race it and orphan whichever asset lost.
    if (uploadingImage.current) return
    // Masks are fractions of the picture, so on a new one they would cover the wrong places.
    const current = latestDraft.current
    const masks = parseOcclusion(current.values[OCCLUSION_MASKS_FIELD] ?? "").masks.length
    const replacing = masks > 0 && (current.media[OCCLUSION_IMAGE_FIELD]?.length ?? 0) > 0
    if (
      replacing &&
      !(await dialog.confirm({
        title: fc("OcclusionReplaceImageTitle"),
        message: fc("OcclusionReplaceImageMessage", { 0: masks }),
        confirmLabel: fc("OcclusionReplaceImageConfirm"),
        cancelLabel: t("Common", "Cancel"),
        destructive: true,
      }))
    )
      return
    uploadingImage.current = true
    const generation = draftGeneration.current
    try {
      const asset = await uploadCardAsset(file)
      if (generation !== draftGeneration.current) return
      setDraft((latest) => ({
        ...latest,
        values: replacing
          ? {
              ...latest.values,
              [OCCLUSION_MASKS_FIELD]: serializeOcclusion({ ...parseOcclusion(latest.values[OCCLUSION_MASKS_FIELD] ?? ""), masks: [] }),
            }
          : latest.values,
        media: { ...latest.media, [OCCLUSION_IMAGE_FIELD]: [draftFromUpload(asset, "front")] },
      }))
    } catch (error) {
      toast.warning(fc("OcclusionImageErrorTitle"), { description: describeError(t, error) })
    } finally {
      uploadingImage.current = false
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
    const current = latestDraft.current
    const previous = typeList.find((candidate) => candidate.id === current.typeId)
    if (previous?.generator === OCCLUSION_GENERATOR && previous.id !== next.id) stash.current = stashOcclusion(current)
    let moved = retypeDraft(current, previous, next)
    if (stash.current?.typeId === next.id) moved = restoreOcclusion(moved, stash.current)
    setDraft(moved)
  }

  const canSave = canSaveFact(type, draft)

  /**
   * Compare generated keys from stored material and the draft. This can overcount trashed cards
   * and miss restored cards whose keys are no longer generated.
   */
  const loss = useMemo(() => cardLoss(loaded, typeList, type, draft), [loaded, typeList, type, draft])

  const confirmCardLoss = async (): Promise<boolean> => {
    if (loss.removed.length === 0) return true

    const retyped = draft.typeId !== loaded?.typeId
    // Masks are named in the message, and Cancel takes the focus: Enter should not move cards.
    const byMask = type?.generator === OCCLUSION_GENERATOR && !retyped
    return dialog.confirm({
      title: fc(retyped ? "CardTypeChangeTitle" : "CardEditorCardLossTitle"),
      message: byMask
        ? removalMessage(t, loss.removed, loss.kept)
        : fc(retyped ? "CardTypeChangeMessage" : "CardEditorCardLossMessage", { 0: loss.removed.length }),
      confirmLabel: fc(retyped ? "CardTypeChangeConfirm" : "CardEditorCardLossConfirm"),
      cancelLabel: t("Common", "Cancel"),
      destructive: true,
      ...(byMask ? { initialFocus: "cancel" as const } : {}),
    })
  }

  const save = async () => {
    // An upload that lands after the draft is sent would change the form behind the save.
    if (!canSave || saving || uploadingImage.current) return
    if (!(await confirmCardLoss())) return
    // The form goes inert while saving, which drops focus; a failed save hands it back.
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const sent = latestDraft.current
    setSaving(true)
    try {
      await saveFact(toSaveFact(isEditMode ? (loaded?.id ?? null) : null, { ...sent, deckId }))
      refresh()
    } catch (error) {
      // The dialog deliberately stays open so nothing typed is lost, as on the desktop.
      toast.warning(fc("CardEditorSaveErrorTitle"), {
        description: describeError(t, error),
      })
      window.setTimeout(() => focused?.isConnected && focused.focus(), 0)
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
    stash.current = null
    setSessionAdded((count) => count + 1)
    setDraft((current) => ({ ...current, values: {}, media: {} }))
    baseline.current = snapshotFactDraft({ ...sent, values: {}, media: {} })
    // Focus goes back to the first field so a run can be typed without reaching for the mouse.
    setFocusFirst((signal) => signal + 1)
  }

  const discardGuard = useDiscardGuard({
    isDirty: () => factDraftIsDirty(baseline.current, snapshotFactDraft(draft)),
    onClose,
    confirmation: {
      title: fc("CardEditorDiscardTitle"),
      message: fc("CardEditorDiscardMessage"),
      confirmLabel: fc("CardEditorDiscardConfirm"),
      cancelLabel: t("Common", "Cancel"),
      destructive: true,
    },
  })

  // A save in flight lands whatever happens next, so closing now would only look like a discard.
  const requestClose = () => (saving ? Promise.resolve() : discardGuard())

  const sourceFieldId = type ? (type.generateFrom || type.sortFieldId) : ""

  // Retyping a saved occlusion fact drops its image and masks, and the trash cannot undo that.
  const savedOcclusion =
    isEditMode && typeList.find((candidate) => candidate.id === loaded?.typeId)?.generator === OCCLUSION_GENERATOR

  const header = {
    title: fc(isEditMode ? "CardEditorTitleEdit" : "CardEditorTitleNew"),
    deckId,
    deckChoices: options.map((option) => ({ value: option.id, label: option.pathLabel })),
    onDeck: (next: string) => setDraft((current) => ({ ...current, deckId: next })),
    typeId: draft.typeId,
    typeChoices: typeList.map((candidate) => ({ value: candidate.id, label: candidate.name })),
    onType: changeType,
    typeLockedReason: savedOcclusion ? fc("CardTypeLockedOcclusion") : undefined,
  }

  if (!hydratedOnce || (isEditMode && typeList.length === 0)) return null

  const occlusion = type?.generator === OCCLUSION_GENERATOR ? type : null

  return (
    <Dialog.Root open onOpenChange={(next) => { if (!next) void requestClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        {occlusion ? (
          <OcclusionLayout
            header={header}
            type={occlusion}
            draft={{ ...draft, deckId }}
            loss={loss}
            isEditMode={isEditMode}
            sessionAdded={sessionAdded}
            canSave={canSave}
            saving={saving}
            onValue={setValue}
            onTags={(tags) => setDraft((current) => ({ ...current, tags }))}
            onImage={(file) => void setImage(file)}
            onSave={() => void save()}
            onClose={() => void requestClose()}
          />
        ) : (
          <>
            <Dialog.Content
              aria-describedby={undefined}
              onEscapeKeyDown={(event) => {
                // Radix catches Escape on the document in capture, so a field cannot stop it.
                // Declining the dismiss here lets the field's own handler still run.
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
              <div className="contents" inert={saving}>
                <FactEditorHeader {...header} className="px-5 py-3.5" />
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4" inert={saving}>
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
          </>
        )}
      </Dialog.Portal>
    </Dialog.Root>
  )
}
