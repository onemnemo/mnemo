import { useEffect, useMemo, useRef, useState } from "react"
import { Dialog } from "radix-ui"

import type { CardSide, CardType } from "@/api/types"
import { IconButton } from "@/components/ui/icon-button"
import { useT } from "@/i18n/useT"
import { SelectControl } from "@/settings/components/controls/SelectControl"
import { dialog } from "@/stores/dialog"
import { toast } from "@/stores/toast"

import { useDecksQuery, useFoldersQuery } from "../api"
import { useCardQuery, useCreateCard, useUpdateCard } from "./api"
import { uploadCardAsset } from "./assets"
import { deckOptions } from "./deck-options"
import { draftFromStored, draftFromUpload, toAttachmentInputs, type DraftAttachment } from "./draft"
import { canSaveCard, draftIsDirty, snapshotDraft, MAX_ATTACHMENTS_PER_SIDE } from "./editor-state"
import { EditorFooter } from "./components/EditorFooter"
import { SideField } from "./components/SideField"
import { TagEditor } from "./components/TagEditor"
import { TypeSegment } from "./components/TypeSegment"
import { useCardEditor, type CardEditorTarget } from "./store"

/** Mounted once at the app shell; renders only while the editor store holds a target. */
export function CardEditorOverlay() {
  const target = useCardEditor((state) => state.target)
  const close = useCardEditor((state) => state.close)

  if (!target) return null
  // Keyed on the target so switching from one card to another rebuilds the form rather than
  // leaving the previous card's text in the boxes.
  return <CardEditor key={targetKey(target)} target={target} onClose={close} />
}

function targetKey(target: CardEditorTarget): string {
  return target.kind === "add" ? `add:${target.deckId}` : `edit:${target.cardId}`
}

function CardEditor({ target, onClose }: { target: CardEditorTarget; onClose: () => void }) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)

  const isEditMode = target.kind === "edit"
  const decks = useDecksQuery()
  const folders = useFoldersQuery()
  const card = useCardQuery(target.deckId, isEditMode ? target.cardId : null)
  const createCard = useCreateCard()
  const updateCard = useUpdateCard()

  const [deckId, setDeckId] = useState(target.deckId)
  const [type, setType] = useState<CardType>("classic")
  const [front, setFront] = useState("")
  const [back, setBack] = useState("")
  const [tags, setTags] = useState<string[]>([])
  const [attachments, setAttachments] = useState<DraftAttachment[]>([])
  const [focusedSide, setFocusedSide] = useState<CardSide | null>(null)
  const [sessionAdded, setSessionAdded] = useState(0)
  // Bumped to ask the Front field for focus; a counter rather than a boolean so the same
  // request can be made again for the next card in a run.
  const [focusFront, setFocusFront] = useState(0)

  // Hydrate once the card arrives. The dialog paints empty until then, as the desktop does.
  // Guarded to a single run per card: the query object gets a new identity on every refetch,
  // and a background refetch must not overwrite what the reader has typed since.
  const loaded = card.data
  const hydratedCardId = useRef<string | null>(null)
  // The draft this card started from: an add form starts empty, an edit form starts at
  // whatever hydrates in. Closing without moving away from this is not losing anything.
  const baseline = useRef(snapshotDraft({ front: "", back: "", tags: [], attachments: [] }))
  useEffect(() => {
    if (!loaded || hydratedCardId.current === loaded.id) return
    hydratedCardId.current = loaded.id
    setDeckId(loaded.deckId)
    setType(loaded.type)
    setFront(loaded.front)
    setBack(loaded.back)
    setTags(loaded.tags)
    const hydratedAttachments = loaded.attachments.map(draftFromStored)
    setAttachments(hydratedAttachments)
    baseline.current = snapshotDraft({
      front: loaded.front,
      back: loaded.back,
      tags: loaded.tags,
      attachments: hydratedAttachments,
    })
  }, [loaded])

  // A card that cannot be loaded has nothing to edit; the desktop says so and closes, and the
  // deck page behind this dialog is already the right place to be.
  useEffect(() => {
    if (card.isError) onClose()
  }, [card.isError, onClose])

  const options = useMemo(
    () => deckOptions(decks.data ?? [], folders.data ?? []),
    [decks.data, folders.data],
  )

  // Bumped whenever the draft is replaced wholesale. An upload started against the previous
  // card must not land in the next one, which is reachable in add mode: attach an image, hit
  // the save shortcut, and the response arrives after the form has already been cleared.
  const draftGeneration = useRef(0)

  const sideAttachments = (side: CardSide) => attachments.filter((item) => item.side === side)

  const attachFiles = async (side: CardSide, files: File[]) => {
    // Trimmed up front so a batch drop does not upload files it has no room for; the real cap
    // is enforced in the state updater below, where concurrent drops cannot race past it.
    const room = MAX_ATTACHMENTS_PER_SIDE - sideAttachments(side).length
    // Read once for the whole batch. Re-reading per file would let every upload after the
    // first adopt the new generation and land on the card the save just started.
    const generation = draftGeneration.current
    for (const file of files.slice(0, Math.max(0, room))) {
      try {
        const asset = await uploadCardAsset(file)
        // Stop rather than skip, so the rest of the batch is not uploaded just to be dropped.
        if (generation !== draftGeneration.current) return
        setAttachments((current) =>
          current.filter((item) => item.side === side).length >= MAX_ATTACHMENTS_PER_SIDE
            ? current
            : [...current, draftFromUpload(asset, side)],
        )
      } catch {
        // A rejected upload (wrong format, too large) drops the file silently, matching the
        // desktop's own catch-and-carry-on around its picker.
      }
    }
  }

  const canSave = canSaveCard({ deckId, type, front, back })
  const saving = createCard.isPending || updateCard.isPending

  const save = async () => {
    if (!canSave || saving) return
    const body = {
      type,
      front: front.trim(),
      back: back.trim(),
      tags,
      attachments: toAttachmentInputs(attachments),
    }

    try {
      if (isEditMode) {
        await updateCard.mutateAsync({ cardId: target.cardId, ...body, deckId })
        onClose()
        return
      }

      await createCard.mutateAsync({ deckId, ...body })
    } catch (error) {
      // The dialog deliberately stays open so the card is not lost, as on the desktop. The
      // desktop reports this in a modal; here it is a toast, which is how the rest of the app
      // reports a failed action.
      toast.warning(fc("CardEditorSaveErrorTitle"), {
        description: error instanceof Error ? error.message : undefined,
      })
      return
    }

    // Add mode saves and stays open. Deck, type and tags carry to the next card - they are
    // usually the same for a run of cards - while the body and its images start clean.
    draftGeneration.current += 1
    setSessionAdded((count) => count + 1)
    setFront("")
    setBack("")
    setAttachments([])
    baseline.current = snapshotDraft({ front: "", back: "", tags, attachments: [] })
    // Focus goes back to Front so a run of cards can be typed without reaching for the mouse.
    setFocusFront((signal) => signal + 1)
  }

  // The single funnel every dismiss path goes through: Escape, a backdrop or outside click,
  // the header close button, and the footer's Close button all end up here. Typed content that
  // has not been saved is confirmed rather than silently dropped.
  const requestClose = async () => {
    const current = snapshotDraft({ front, back, tags, attachments })
    if (draftIsDirty(baseline.current, current)) {
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

  return (
    <Dialog.Root open onOpenChange={(next) => { if (!next) void requestClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => {
            // Radix watches for Escape in the capture phase on the document, so an inner field
            // cannot stop the event from reaching it. The dialog declines the dismiss instead,
            // and the field's own handler still runs as the event bubbles down to it.
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
              onChange={setDeckId}
              label={fc("ColDeck")}
              className="min-w-[180px]"
            />
            <div className="flex-1" />
            <TypeSegment value={type} onChange={setType} />
            <Dialog.Close asChild>
              <IconButton icon="common/x" iconSize={14} label={t("Common", "Close")} />
            </Dialog.Close>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4">
            <SideField
              side="front"
              label={fc("FieldFront")}
              value={front}
              isCloze={type === "cloze"}
              focused={focusedSide === "front"}
              focusSignal={focusFront}
              attachments={sideAttachments("front")}
              onChange={setFront}
              onFocus={() => setFocusedSide("front")}
              onAttachFiles={(side, files) => void attachFiles(side, files)}
              onRemoveAttachment={(key) =>
                setAttachments((current) => current.filter((item) => item.key !== key))
              }
            />

            <SideField
              side="back"
              label={fc("FieldBack")}
              value={back}
              isCloze={type === "cloze"}
              focused={focusedSide === "back"}
              attachments={sideAttachments("back")}
              onChange={setBack}
              onFocus={() => setFocusedSide("back")}
              onAttachFiles={(side, files) => void attachFiles(side, files)}
              onRemoveAttachment={(key) =>
                setAttachments((current) => current.filter((item) => item.key !== key))
              }
            />

            <p className="text-[11.5px] text-ink-3">{fc("CardEditorAttachmentsHint")}</p>

            <TagEditor tags={tags} onChange={setTags} />
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
