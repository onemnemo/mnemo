import { useCallback, useMemo } from "react"

import type { WidgetInstanceDto } from "@/api/types"
import { useI18nStore } from "@/i18n/store"
import { useT } from "@/i18n/useT"
import { formatSmart } from "@/lib/relative-date"
import { useNoteFoldersQuery, useNotesQuery } from "@/notes/api"

import { settingInt, settingString } from "../../config/encode"
import type { WidgetManifest } from "../manifest"
import { buildRecentNoteRows, type RecentNoteRow } from "./rows"

export interface RecentNotesData {
  state: "loading" | "error" | "empty" | "ready"
  rows: RecentNoteRow[]
  retry: () => void
}

/**
 * The most recent notes inside a rolling window, as configured on the instance.
 *
 * Reuses the notes module's own list and folder queries rather than adding overview-scoped ones, so
 * a user who has just come from Notes pays for no second fetch and the two surfaces cannot disagree
 * about what exists.
 */
export function useRecentNotes(instance: WidgetInstanceDto, manifest: WidgetManifest): RecentNotesData {
  const t = useT()
  const language = useI18nStore((state) => state.language)

  const notes = useNotesQuery()
  const folders = useNoteFoldersQuery()

  const days = settingInt(manifest, instance.settings, "days_to_show")
  const limit = settingInt(manifest, instance.settings, "limit")
  const sortBy = settingString(manifest, instance.settings, "sort_by")

  const refetchNotes = notes.refetch
  const refetchFolders = folders.refetch
  const retry = useCallback(() => {
    void refetchNotes()
    void refetchFolders()
  }, [refetchNotes, refetchFolders])

  const noteList = notes.data
  const folderList = folders.data

  const rows = useMemo(
    () =>
      noteList === undefined
        ? []
        : buildRecentNoteRows(noteList, folderList ?? [], {
            days,
            limit,
            sortBy,
            // Read once per rebuild rather than per row, so every row in one render measures its
            // window and its wording against the same instant.
            now: Date.now(),
            formatDate: (timestamp, now) => formatSmart(timestamp, now, t, language),
            untitled: t("RecentNotes", "Untitled"),
          }),
    [noteList, folderList, days, limit, sortBy, t, language],
  )

  const state = notes.isError || folders.isError
    ? "error"
    : notes.isPending || folders.isPending
      ? "loading"
      : rows.length === 0
        ? "empty"
        : "ready"

  return { state, rows, retry }
}
