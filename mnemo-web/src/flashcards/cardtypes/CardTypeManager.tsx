import { useEffect, useRef, useState } from "react"
import { Dialog } from "radix-ui"

import { ApiError } from "@/api/client"
import { onDirtyCheck } from "@/app/shutdown"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { useT } from "@/i18n/useT"
import { dialog } from "@/stores/dialog"
import { toast } from "@/stores/toast"

import { deleteCardType, saveCardType, useCardTypesQuery, useRefreshAfterFactWrite } from "../facts/api"
import {
  addField,
  addLayout,
  canSave as canSaveDrafts,
  draftFromSummary,
  isDirty as draftsAreDirty,
  moveField,
  newDraft,
  patchField,
  patchLayout,
  removeField,
  removeLayout,
  removedLayouts,
  toSaveDto,
  uniqueName,
  type CardTypeDraft,
} from "./card-types"
import { CardTypeDetails } from "./components/CardTypeDetails"
import { CardTypeSidebar } from "./components/CardTypeSidebar"

export function CardTypeManager({
  initialTypeId,
  onClose,
}: {
  initialTypeId: string | null
  onClose: () => void
}) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)

  const types = useCardTypesQuery()
  const refresh = useRefreshAfterFactWrite()

  const [drafts, setDrafts] = useState<CardTypeDraft[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const selected = drafts.find((draft) => draft.key === selectedKey) ?? null

  // Built once the types arrive. A background refetch must not overwrite edits in progress, so
  // this runs a single time rather than on every new query identity.
  const hydrated = useRef(false)
  const typeList = types.data
  useEffect(() => {
    if (hydrated.current || !typeList) return
    hydrated.current = true

    const built = typeList.map(draftFromSummary)
    const initial = built.find((draft) => draft.key === initialTypeId) ?? built[0] ?? null
    setDrafts(built)
    setSelectedKey(initial?.key ?? null)
  }, [typeList, initialTypeId])

  // Nothing to manage if the types never arrived, and the screen behind this dialog is already the
  // right place to be. Keyed on the error alone, since fc is a new function every render.
  const loadError = types.isError ? types.error : null
  useEffect(() => {
    if (!loadError) return
    toast.warning(t("Flashcards", "CardTypesLoadErrorTitle"), { description: loadError.message })
    onClose()
  }, [loadError, onClose, t])

  // Read current state through a ref without re-registering on every edit.
  const latestDrafts = useRef(drafts)
  latestDrafts.current = drafts
  useEffect(() => onDirtyCheck(() => draftsAreDirty(latestDrafts.current)), [])

  const patchSelected = (transform: (draft: CardTypeDraft) => CardTypeDraft) => {
    if (saving) return
    setDrafts((current) => current.map((draft) => (draft.key === selectedKey ? transform(draft) : draft)))
  }

  const createDraft = () => {
    if (saving) return
    const name = uniqueName(fc("CardTypesNewType"), drafts.map((draft) => draft.name))
    const draft = newDraft(name, fc("ColFront"), fc("ColBack"), fc("CardTypesFirstCardName"))
    setDrafts((current) => [...current, draft])
    setSelectedKey(draft.key)
  }

  const removeDraft = async (key: string) => {
    const draft = drafts.find((item) => item.key === key)
    if (saving || !draft) return

    const dropLocally = () => {
      setDrafts((current) => {
        const index = current.findIndex((item) => item.key === key)
        const next = current.filter((item) => item.key !== key)
        if (key === selectedKey) setSelectedKey(next[Math.min(index, next.length - 1)]?.key ?? null)
        return next
      })
    }

    // Never saved, so there is nothing to confirm and nothing to ask the server.
    if (!draft.serverId) {
      dropLocally()
      return
    }

    const confirmed = await dialog.confirm({
      title: fc("CardTypesDeleteTitle"),
      message: fc("CardTypesDeleteMessage", { 0: draft.name }),
      confirmLabel: t("Common", "Delete"),
      cancelLabel: t("Common", "Cancel"),
      destructive: true,
    })
    if (!confirmed) return

    try {
      await deleteCardType(draft.serverId)
    } catch (error) {
      // Keep refused deletions visible and translate the error code instead of displaying server
      // English.
      const holdsMaterial = error instanceof ApiError && error.code === "card_type_in_use"
      toast.warning(fc("CardTypesDeleteBlockedTitle"), {
        description: holdsMaterial
          ? fc("CardTypesDeleteBlockedMessage")
          : error instanceof Error
            ? error.message
            : undefined,
      })
      return
    }

    dropLocally()
    await refresh()
  }

  const canSave = canSaveDrafts(drafts)

  /**
   * Confirm all layout removals before saving any type, since each save commits independently.
   * This does not detect losses caused by changes to Requires.
   */
  const confirmRemovedCards = async (): Promise<boolean> => {
    const stored = new Map((types.data ?? []).map((summary) => [summary.type.id, summary]))

    for (const draft of drafts) {
      if (!draft.dirty || !draft.serverId) continue

      const before = stored.get(draft.serverId)
      // Nothing live is using the type, and the sweep only reaches live material.
      if (!before || before.factCount === 0) continue

      const removed = removedLayouts(before.type, draft)
      if (removed.length === 0) continue

      const confirmed = await dialog.confirm({
        title: fc("CardTypesRemoveCardsTitle"),
        message: fc("CardTypesRemoveCardsMessage", {
          0: removed
            .map((layout) => layout.name.trim())
            .filter((name) => name.length > 0)
            .join(", "),
          1: draft.name.trim(),
          2: before.factCount,
        }),
        confirmLabel: fc("CardTypesRemoveCardsConfirm"),
        cancelLabel: t("Common", "Cancel"),
        destructive: true,
      })
      if (!confirmed) return false
    }

    return true
  }

  const save = async () => {
    if (!canSave || saving) return
    if (!(await confirmRemovedCards())) return
    setSaving(true)
    try {
      for (const draft of drafts.filter((item) => item.dirty)) {
        const saved = await saveCardType(toSaveDto(draft))
        // Marked clean as each one lands rather than all at the end. The dialog stays open when a
        // save fails so the work is not lost, which makes Save the retry, and a retry must not
        // create the types that already succeeded a second time.
        setDrafts((current) =>
          current.map((item) =>
            item.key === draft.key ? { ...item, serverId: saved.id, dirty: false } : item,
          ),
        )
      }
      onClose()
    } catch (error) {
      // Left open so the edits survive, the way a failed material save keeps the material.
      toast.warning(fc("CardTypesSaveErrorTitle"), {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setSaving(false)
      // Refreshed on both paths: the loop is not one transaction, so a failure part way through
      // still leaves earlier types written, and every card those types make is downstream of them.
      await refresh()
    }
  }

  return (
    <Dialog.Root open onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[86vh] w-[880px] max-w-[calc(100vw-3rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-line-soft bg-canvas shadow-pop focus:outline-none"
        >
          <div className="flex items-start gap-3.5 border-b border-line-soft px-5 py-3.5">
            <div className="min-w-0 flex-1 space-y-0.5">
              <Dialog.Title className="text-[14px] font-semibold text-ink">{fc("CardTypesTitle")}</Dialog.Title>
              <div className="text-[12px] text-ink-3">{fc("CardTypesSubtitle")}</div>
            </div>
            <Dialog.Close asChild>
              <IconButton icon="common/x" iconSize={14} label={t("Common", "Close")} />
            </Dialog.Close>
          </div>

          <div className="flex min-h-0 flex-1">
            {selected ? (
              <>
                <CardTypeSidebar
                  drafts={drafts}
                  selectedKey={selectedKey}
                  onSelect={setSelectedKey}
                  onCreate={createDraft}
                  onDelete={(key) => void removeDraft(key)}
                />
                <CardTypeDetails
                  draft={selected}
                  onRename={(name) => patchSelected((draft) => ({ ...draft, name, dirty: true }))}
                  onPatchField={(fieldId, patch) => patchSelected((draft) => patchField(draft, fieldId, patch))}
                  onMoveField={(fieldId, delta) => patchSelected((draft) => moveField(draft, fieldId, delta))}
                  onRemoveField={(fieldId) => patchSelected((draft) => removeField(draft, fieldId))}
                  onSetSortField={(fieldId) =>
                    patchSelected((draft) => ({ ...draft, sortFieldId: fieldId, dirty: true }))
                  }
                  onAddField={() => patchSelected((draft) => addField(draft, fc("CardTypesNewFieldName")))}
                  onPatchLayout={(layoutId, patch) => patchSelected((draft) => patchLayout(draft, layoutId, patch))}
                  onRemoveLayout={(layoutId) => patchSelected((draft) => removeLayout(draft, layoutId))}
                  onAddLayout={() => patchSelected((draft) => addLayout(draft, fc("CardTypesNewCardName")))}
                />
              </>
            ) : (
              <div className="grid h-[420px] w-full place-items-center text-ink-3">{fc("StudyLoading")}</div>
            )}
          </div>

          <div className="flex items-center border-t border-line-soft px-5 py-3">
            <p className="text-[11.5px] text-ink-3">{fc("CardTypesSaveNote")}</p>
            <div className="flex-1" />
            <div className="flex items-center gap-2">
              <Button variant="ghost" className="h-[34px] px-4" onClick={onClose}>
                {t("Common", "Cancel")}
              </Button>
              <Button className="h-[34px] px-[18px]" disabled={!canSave || saving} onClick={() => void save()}>
                {fc("Save")}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
