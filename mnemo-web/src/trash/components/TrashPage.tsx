import { useEffect, useMemo, useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { useT } from "@/i18n/useT"
import { dialog } from "@/stores/dialog"
import { toast } from "@/stores/toast"

import { useEmptyTrashMutation, usePurgeMutation, useRestoreMutation, useTrashQuery } from "../api"
import type { TrashEntryDto, TrashRestoreResultDto } from "../types"
import { TrashRow } from "./TrashRow"
import { TrashToolbar } from "./TrashToolbar"

/** One request per pause in typing rather than one per keystroke. */
const SEARCH_DEBOUNCE_MS = 250

/**
 * The recovery surface: everything deleted that has not expired, and the two things that can be
 * done with each of them.
 *
 * It lives in settings rather than in a module because the trash is one list across all of them.
 * Somebody who deleted the wrong thing an hour ago and cannot remember which module it was in
 * has one place to look, and the alternative, a trash per module, makes that person search four.
 */
export function TrashPage() {
  const t = useT()

  const [typed, setTyped] = useState("")
  const [query, setQuery] = useState("")
  const [kind, setKind] = useState<string | null>(null)
  // Entries whose restore came back with nowhere to put them. Held per session rather than
  // fetched: the server only reports it in answer to an attempt, so nothing is known until one
  // has been made.
  const [needsDestination, setNeedsDestination] = useState<readonly string[]>([])

  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [typed])

  const trash = useTrashQuery({ kind: kind ?? undefined, query })
  const restore = useRestoreMutation()
  const purge = usePurgeMutation()
  const empty = useEmptyTrashMutation()

  const entries = useMemo(() => trash.data?.pages.flatMap((page) => page.entries) ?? [], [trash.data])
  const busy = restore.isPending || purge.isPending || empty.isPending
  const now = Date.now()
  const filtering = query.trim().length > 0 || kind !== null

  /**
   * The title of the one entry holding this one back, when the list happens to have it loaded.
   *
   * Only ever one. A run of titles would have to be read into a sentence written for a single name,
   * and past one the count is the more useful thing to say anyway.
   */
  function blockerTitle(ids: readonly string[]): string {
    if (ids.length !== 1) return ""
    return entries.find((entry) => entry.id === ids[0])?.title ?? ""
  }

  async function restoreEntry(entry: TrashEntryDto, destinationId?: string) {
    let result: TrashRestoreResultDto | undefined
    try {
      result = (await restore.mutateAsync({ entryIds: [entry.id], destinationId })).results[0]
    } catch {
      toast.warning(t("Common", "Error"))
      return
    }
    if (!result) return

    if (result.outcome === "destination_required") {
      setNeedsDestination((current) => (current.includes(entry.id) ? current : [...current, entry.id]))
    }
    reportRestore(result, t)
  }

  async function purgeEntry(entry: TrashEntryDto) {
    const confirmed = await dialog.confirm({
      title: t("Trash", "DeleteForever"),
      message: t("Trash", "DeleteForeverConfirmFormat", { 0: entry.title }),
      destructive: true,
      confirmLabel: t("Trash", "DeleteForever"),
      cancelLabel: t("Common", "Cancel"),
    })
    if (!confirmed) return

    try {
      const result = await purge.mutateAsync(entry.id)
      if (result.purged) return
      const holding = blockerTitle(result.blockingEntryIds)
      toast.warning(
        holding
          ? t("Trash", "PurgeBlockedByFormat", { 0: holding })
          : t("Trash", "PurgeBlockedFormat", { 0: result.blockingEntryIds.length }),
      )
    } catch {
      toast.warning(t("Common", "Error"))
    }
  }

  async function emptyEverything() {
    const confirmed = await dialog.confirm({
      title: t("Trash", "EmptyTrash"),
      message: t("Trash", "EmptyTrashConfirm"),
      destructive: true,
      confirmLabel: t("Trash", "EmptyTrash"),
      cancelLabel: t("Common", "Cancel"),
    })
    if (!confirmed) return

    try {
      const result = await empty.mutateAsync()
      if (result.blocked.length > 0) toast.warning(t("Trash", "EmptyBlockedFormat", { 0: result.blocked.length }))
      else toast.success(t("Trash", "EmptyDoneFormat", { 0: result.purgedCount }))
    } catch {
      toast.warning(t("Common", "Error"))
    }
  }

  return (
    <>
      <TrashToolbar
        query={typed}
        onQueryChange={setTyped}
        kind={kind}
        onKindChange={setKind}
        onEmpty={() => void emptyEverything()}
        // Empty destroys the whole trash, not the filtered view, so it is only offered when
        // the list on screen is the whole trash and the button cannot mean two things.
        emptyDisabled={busy || filtering || entries.length === 0}
      />

      {entries.length > 0 ? (
        <div className="mt-4 [&>*+*]:border-t [&>*+*]:border-line-soft">
          {entries.map((entry) => (
            <TrashRow
              key={entry.id}
              entry={entry}
              now={now}
              busy={busy}
              needsDestination={needsDestination.includes(entry.id)}
              onRestore={(destinationId) => void restoreEntry(entry, destinationId)}
              onPurge={() => void purgeEntry(entry)}
            />
          ))}
        </div>
      ) : null}

      {trash.hasNextPage ? (
        <div className="mt-4 flex justify-center">
          <Button
            variant="ghost"
            size="md"
            disabled={trash.isFetchingNextPage}
            onClick={() => void trash.fetchNextPage()}
          >
            {t("Trash", "LoadMore")}
          </Button>
        </div>
      ) : null}

      {trash.isSuccess && entries.length === 0 ? (
        filtering ? (
          <p className="mt-8 text-[13px] text-ink-3">{t("Trash", "NoMatches")}</p>
        ) : (
          <EmptyState
            className="mt-16"
            icon="common/trash"
            title={t("Trash", "EmptyTitle")}
            description={t("Trash", "EmptyDescription")}
          />
        )
      ) : null}

      {trash.isError ? (
        <div className="mt-8 flex items-start gap-2.5 rounded-lg bg-danger-wash px-3 py-2.5">
          <AppIcon name="triangle-alert" size={16} strokeWidth={1.8} className="mt-px shrink-0 text-danger" />
          <p className="text-[12.5px] leading-snug text-ink-2">{t("Trash", "Unavailable")}</p>
        </div>
      ) : null}
    </>
  )
}

/**
 * Says what happened to one entry.
 *
 * Every outcome is reported, including the ones that worked: the row leaves the list either way,
 * so without this a restore that went somewhere other than where it came from looks exactly like
 * one that went home.
 */
function reportRestore(result: TrashRestoreResultDto, t: ReturnType<typeof useT>) {
  switch (result.outcome) {
    case "restored":
      toast.success(t("Trash", "RestoredFormat", { 0: result.title }))
      return
    case "rooted":
      toast.info(t("Trash", "RestoredToRootFormat", { 0: result.title }))
      return
    case "container_held":
      toast.warning(t("Trash", "RestoreContainerHeld"))
      return
    case "destination_required":
      toast.warning(t("Trash", "RestoreNeedsDestination"))
      return
    case "no_longer_generated":
      toast.warning(t("Trash", "RestoreNoLongerGenerated"))
      return
    case "missing":
      toast.warning(t("Trash", "RestoreMissing"))
  }
}
