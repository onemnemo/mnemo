import { useEffect, useRef, useState } from "react"
import { Dialog } from "radix-ui"

import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { useT } from "@/i18n/useT"
import { dialog } from "@/stores/dialog"
import { toast } from "@/stores/toast"

import {
  assignDeckPreset,
  createPreset,
  deletePreset,
  updatePreset,
  useDeckPresetQuery,
  usePresetsQuery,
  useRefreshAfterPresetWrite,
} from "./api"
import { PresetDetails } from "./components/PresetDetails"
import { PresetSidebar } from "./components/PresetSidebar"
import {
  canSave as canSaveDrafts,
  differs,
  draftFromPreset,
  formatSteps,
  newDraft,
  parseSteps,
  restoreDefaults,
  toSaveDto,
  uniqueName,
  type PresetDraft,
} from "./presets"
import type { ReviewSettingsTarget } from "./store"

export function ReviewSettings({
  target,
  onClose,
}: {
  target: ReviewSettingsTarget
  onClose: () => void
}) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)

  const presets = usePresetsQuery(true)
  const deck = useDeckPresetQuery(target.deckId)
  const refresh = useRefreshAfterPresetWrite()

  const [drafts, setDrafts] = useState<PresetDraft[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [renamingKey, setRenamingKey] = useState<string | null>(null)
  const [stepsText, setStepsText] = useState("")
  const [originalPresetId, setOriginalPresetId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const selected = drafts.find((draft) => draft.key === selectedKey) ?? null
  const stepsInvalid = parseSteps(stepsText) === null

  // Build the drafts once everything the selection depends on has arrived. Waiting for the deck
  // too - when there is one - avoids opening on Standard and then jumping to the deck's preset.
  const hydrated = useRef(false)
  const presetList = presets.data
  const deckPresetId = target.deckId === null ? null : deck.data?.presetId
  useEffect(() => {
    if (hydrated.current || !presetList) return
    if (target.deckId !== null && deckPresetId === undefined) return
    hydrated.current = true

    const built = presetList.map(draftFromPreset)
    const initial =
      built.find((draft) => draft.key === deckPresetId) ??
      built.find((draft) => draft.isStandard) ??
      built[0] ??
      null

    setDrafts(built)
    setOriginalPresetId(deckPresetId ?? null)
    setSelectedKey(initial?.key ?? null)
    setStepsText(initial ? formatSteps(initial.learningSteps) : "")
  }, [presetList, deckPresetId, target.deckId])

  // Nothing to edit if the presets never arrived. The deck matters just as much when there is
  // one: hydration waits for its preset, so without it the dialog would sit on the placeholder
  // forever rather than fail. Keyed on the error alone - fc is a new function every render.
  const loadError = presets.isError ? presets.error : deck.isError ? deck.error : null
  useEffect(() => {
    if (!loadError) return
    toast.warning(t("Flashcards", "ReviewSettingsLoadErrorTitle"), { description: loadError.message })
    onClose()
  }, [loadError, onClose, t])

  const patchSelected = (patch: Partial<PresetDraft>) => {
    if (saving) return
    setDrafts((current) =>
      current.map((draft) => {
        if (draft.key !== selectedKey) return draft
        // A control that re-reports the value it already had is not an edit, and marking the
        // draft dirty for it would offer Save with nothing to save.
        const changed = Object.entries(patch).some(([key, value]) =>
          differs(draft[key as keyof PresetDraft], value),
        )
        return changed ? { ...draft, ...patch, dirty: true } : draft
      }),
    )
  }

  const selectPreset = (key: string) => {
    if (key === selectedKey) return
    const next = drafts.find((draft) => draft.key === key)
    if (!next) return
    setSelectedKey(key)
    setRenamingKey(null)
    // The steps box resets to the incoming preset's value, which also clears an error left on
    // screen by text that never parsed - the desktop discards that text the same way.
    setStepsText(formatSteps(next.learningSteps))
  }

  const changeStepsText = (next: string) => {
    if (saving) return
    setStepsText(next)
    const parsed = parseSteps(next)
    // Only a readable list reaches the draft; unreadable text stays in the box and locks Save.
    if (parsed) patchSelected({ learningSteps: parsed })
  }

  const createDraft = () => {
    if (saving) return
    const name = uniqueName(fc("ReviewSettingsNewPreset"), drafts.map((draft) => draft.name))
    const draft = newDraft(`new:${crypto.randomUUID()}`, name)
    setDrafts((current) => [...current, draft])
    setSelectedKey(draft.key)
    setStepsText(formatSteps(draft.learningSteps))
    // Straight into rename, so naming it is the next thing that happens rather than a step to
    // remember - the desktop opens the box on create too.
    setRenamingKey(draft.key)
  }

  const commitRename = (key: string, name: string) => {
    const trimmed = name.trim()
    setRenamingKey(null)
    if (saving || !trimmed) return
    setDrafts((current) =>
      current.map((draft) =>
        draft.key === key && draft.name !== trimmed ? { ...draft, name: trimmed, dirty: true } : draft,
      ),
    )
  }

  const removeDraft = async (key: string) => {
    const draft = drafts.find((item) => item.key === key)
    if (saving || !draft) return

    const dropLocally = () => {
      setDrafts((current) => {
        const index = current.findIndex((item) => item.key === key)
        const next = current.filter((item) => item.key !== key)
        if (key === selectedKey) {
          const fallback = next[Math.min(index, next.length - 1)] ?? null
          setSelectedKey(fallback?.key ?? null)
          setStepsText(fallback ? formatSteps(fallback.learningSteps) : "")
        }
        return next
      })
    }

    // Never persisted, so there is nothing to confirm and nothing to ask the server.
    if (!draft.serverId) {
      dropLocally()
      return
    }

    const confirmed = await dialog.confirm({
      title: fc("ReviewSettingsDeleteConfirmTitle"),
      message: fc("ReviewSettingsDeleteConfirmMessage", { 0: draft.name }),
      confirmLabel: fc("ReviewSettingsDelete"),
      cancelLabel: t("Common", "Cancel"),
      destructive: true,
    })
    if (!confirmed) return

    try {
      await deletePreset(draft.serverId)
    } catch (error) {
      // The server refuses a preset that decks still use. The row stays, because it is still
      // real - the count beside it is what explains the refusal.
      toast.warning(fc("ReviewSettingsDeleteBlockedTitle"), {
        description: error instanceof Error ? error.message : undefined,
      })
      return
    }

    dropLocally()
    await refresh()
  }

  const canSave = canSaveDrafts({
    drafts,
    stepsValid: !stepsInvalid,
    deckId: target.deckId,
    selectedKey,
    originalPresetId,
  })

  const save = async () => {
    if (!canSave || saving) return
    setSaving(true)
    try {
      // A newly created preset only gets its real id here, so the deck binding below has to
      // look the saved id up rather than reuse the local one.
      const savedIds = new Map<string, string>()
      for (const draft of drafts.filter((item) => item.dirty)) {
        const saved = draft.serverId
          ? await updatePreset(draft.serverId, toSaveDto(draft))
          : await createPreset(toSaveDto(draft))
        savedIds.set(draft.key, saved.id)
        // Marked clean as each one lands rather than all at the end. The dialog stays open when
        // a save fails so the work is not lost, which makes Save the retry - and a retry must
        // not create the presets that already succeeded a second time.
        setDrafts((current) =>
          current.map((item) =>
            item.key === draft.key ? { ...item, serverId: saved.id, dirty: false } : item,
          ),
        )
      }

      if (target.deckId && selectedKey) {
        const boundId =
          savedIds.get(selectedKey) ?? drafts.find((item) => item.key === selectedKey)?.serverId
        if (boundId && boundId !== originalPresetId) {
          await assignDeckPreset(target.deckId, boundId)
          setOriginalPresetId(boundId)
        }
      }

      onClose()
    } catch (error) {
      // Left open so the edits survive, the way a failed card save keeps the card.
      toast.warning(fc("ReviewSettingsSaveErrorTitle"), {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setSaving(false)
      // Refreshed on both paths: the loop is not a transaction, so a failure part-way through
      // still leaves earlier presets written and the deck rows downstream of them stale.
      await refresh()
    }
  }

  return (
    <Dialog.Root open onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => {
            // Radix listens for Escape on the document, so the rename box cannot stop the event
            // reaching it. The dialog declines the dismiss and the box still cancels itself.
            if (document.activeElement?.closest("[data-inline-editor]")) event.preventDefault()
          }}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[86vh] w-[856px] max-w-[calc(100vw-3rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-line-soft bg-canvas shadow-pop focus:outline-none"
        >
          <div className="flex items-start gap-3.5 border-b border-line-soft px-5 py-3.5">
            <div className="min-w-0 flex-1 space-y-0.5">
              <Dialog.Title className="text-[14px] font-semibold text-ink">{fc("ReviewSettingsTitle")}</Dialog.Title>
              {target.deckName ? <div className="truncate text-[12px] text-ink-3">{target.deckName}</div> : null}
            </div>
            <Dialog.Close asChild>
              <IconButton icon="common/x" iconSize={14} label={t("Common", "Close")} />
            </Dialog.Close>
          </div>

          <div className="flex min-h-0 flex-1">
            {selected ? (
              <>
                <PresetSidebar
                  drafts={drafts}
                  selectedKey={selectedKey}
                  renamingKey={renamingKey}
                  editingNote={fc("ReviewSettingsEditingNoteFormat", { 0: selected.name })}
                  onSelect={selectPreset}
                  onBeginRename={setRenamingKey}
                  onCommitRename={commitRename}
                  onCancelRename={() => setRenamingKey(null)}
                  onCreate={createDraft}
                  onDelete={(key) => void removeDraft(key)}
                />
                <PresetDetails
                  draft={selected}
                  stepsText={stepsText}
                  stepsInvalid={stepsInvalid}
                  onPatch={patchSelected}
                  onStepsTextChange={changeStepsText}
                />
              </>
            ) : (
              <div className="grid h-[420px] w-full place-items-center text-ink-3">{fc("StudyLoading")}</div>
            )}
          </div>

          <div className="flex items-center border-t border-line-soft px-5 py-3">
            <Button
              variant="ghost"
              className="h-[34px] px-0 text-[12.5px]"
              disabled={!selected || saving}
              onClick={() => {
                if (!selected || saving) return
                setDrafts((current) =>
                  current.map((draft) => (draft.key === selected.key ? restoreDefaults(draft) : draft)),
                )
                setStepsText(formatSteps(restoreDefaults(selected).learningSteps))
              }}
            >
              {fc("ReviewSettingsRestoreDefaults")}
            </Button>

            <div className="flex-1" />

            <div className="flex items-center gap-2">
              <Button variant="ghost" className="h-[34px] px-4" onClick={onClose}>
                {t("Common", "Cancel")}
              </Button>
              <Button
                className="h-[34px] px-[18px]"
                disabled={!canSave || saving}
                onClick={() => void save()}
              >
                {fc("Save")}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
