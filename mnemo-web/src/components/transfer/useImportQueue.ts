import { useEffect, useRef, useState } from "react"

import { ApiError } from "@/api/client"
import { describeError } from "@/api/error-copy"
import type { TranslateFn } from "@/i18n/types"
import { toast } from "@/stores/toast"

import { chunked, dedupeKey, MAX_QUEUED, type PickedFile, type QueuedImport } from "./import-queue"
import { importResultNotice, mergeResults, type ImportResultLike } from "./import-result"

const UPLOAD_POOL = 4

export interface ImportQueueOptions<U, Q extends QueuedImport> {
  upload: (file: File) => Promise<U>
  discard: (uploadId: string) => unknown
  toRow: (key: string, upload: U) => Q
  accepts: (fileName: string) => boolean
  failureNote: (error: unknown, fileName: string) => string
  onEdit?: () => void
}

export interface ImportOutcome<R> {
  results: R[]
  /** Null when every chunk went through. */
  error: unknown
  /** Ready rows no request imported. */
  unsent: number
  closed: boolean
}

/** The queue the transfer dialogs share. Uploads a few files at a time, imports in chunks. */
export function useImportQueue<U, Q extends QueuedImport>(options: ImportQueueOptions<U, Q>) {
  const [queue, setQueueState] = useState<Q[]>([])
  const [refused, setRefused] = useState<string[]>([])
  const [overflow, setOverflow] = useState(false)
  const [empty, setEmpty] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  // The ref is the source of truth: upload callbacks and the unmount cleanup outlive any render.
  const queueRef = useRef<Q[]>([])
  const latest = useRef(options)
  latest.current = options
  // Uploads are never aborted, so a removed row's staged bytes still get an id to discard.
  const running = useRef(new Set<string>())
  const waiting = useRef<{ key: string; file: File }[]>([])
  const alive = useRef(true)
  // Rows inside a running import request. The host consumes them, so closing must not discard them.
  const sending = useRef(new Set<string>())

  const setQueue = (next: (current: Q[]) => Q[]) => {
    queueRef.current = next(queueRef.current)
    setQueueState(queueRef.current)
  }
  const patch = (key: string, change: Partial<Q>) =>
    setQueue((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)))
  const drop = (keys: Set<string>) => setQueue((current) => current.filter((row) => !keys.has(row.key)))

  const pump = () => {
    while (running.current.size < UPLOAD_POOL && waiting.current.length > 0) {
      const { key, file } = waiting.current.shift()!
      running.current.add(key)
      latest.current
        .upload(file)
        .then((upload) => {
          const row = latest.current.toRow(key, upload)
          if (alive.current && queueRef.current.some((queued) => queued.key === key)) patch(key, row)
          else if (row.uploadId) latest.current.discard(row.uploadId)
        })
        .catch((error: unknown) => {
          patch(key, { status: "rejected", notes: [{ text: latest.current.failureNote(error, file.name) }] } as Partial<Q>)
        })
        .finally(() => {
          running.current.delete(key)
          if (alive.current) pump()
        })
    }
  }

  useEffect(() => {
    // Set on the way in as well, so a StrictMode remount does not discard every later upload.
    alive.current = true
    return () => {
      alive.current = false
      waiting.current = []
      for (const row of queueRef.current) {
        if (row.uploadId && !sending.current.has(row.key)) latest.current.discard(row.uploadId)
      }
    }
  }, [])

  const add = (picked: readonly PickedFile[]) => {
    if (!alive.current) return
    // Only a folder walk can hand over nothing, and its notice stands alone.
    setEmpty(picked.length === 0)
    if (picked.length === 0) return
    const seen = new Set(queueRef.current.map((row) => dedupeKey(row.path ?? "", row.name, row.sizeBytes)))
    const turnedAway: string[] = []
    const fresh: Q[] = []
    let full = false
    for (const { file, path } of picked) {
      if (!latest.current.accepts(file.name)) {
        turnedAway.push(file.name)
        continue
      }
      const id = dedupeKey(path, file.name, file.size)
      if (seen.has(id)) continue
      if (queueRef.current.length + fresh.length >= MAX_QUEUED) {
        full = true
        break
      }
      seen.add(id)
      const key = crypto.randomUUID()
      fresh.push({ key, name: file.name, path: path || undefined, sizeBytes: file.size, status: "uploading" } as Q)
      waiting.current.push({ key, file })
    }
    setRefused(turnedAway)
    setOverflow(full)
    if (fresh.length > 0) {
      setQueue((current) => [...current, ...fresh])
      latest.current.onEdit?.()
    }
    pump()
  }

  const remove = (key: string) => {
    const row = queueRef.current.find((queued) => queued.key === key)
    waiting.current = waiting.current.filter((entry) => entry.key !== key)
    if (row?.uploadId) latest.current.discard(row.uploadId)
    drop(new Set([key]))
    latest.current.onEdit?.()
  }

  const importReady = async <R>(run: (rows: Q[]) => Promise<R>): Promise<ImportOutcome<R>> => {
    const ready = queueRef.current.filter((row) => row.status === "ready" && row.uploadId)
    const results: R[] = []
    let sent = 0
    setProgress({ done: 0, total: ready.length })
    try {
      for (const chunk of chunked(ready)) {
        if (!alive.current) break
        sending.current = new Set(chunk.map((row) => row.key))
        try {
          results.push(await run(chunk))
        } catch (error) {
          // A 400 is refused before the host opens a file, so those uploads are still staged.
          if (!(error instanceof ApiError && error.status === 400)) drop(new Set(chunk.map((row) => row.key)))
          return { results, error, unsent: ready.length - sent, closed: !alive.current }
        }
        sent += chunk.length
        setProgress({ done: sent, total: ready.length })
        drop(new Set(chunk.map((row) => row.key)))
      }
      return { results, error: null, unsent: ready.length - sent, closed: !alive.current }
    } finally {
      sending.current = new Set()
      setProgress(null)
    }
  }

  return { queue, refused, overflow, empty, progress, add, remove, importReady }
}

// Returns true when anything imported. Says nothing once the dialog has closed.
export function announceImport<R extends ImportResultLike>(
  t: TranslateFn,
  outcome: ImportOutcome<R>,
  phrase: (result: R) => string,
): boolean {
  if (outcome.closed) return false
  const failure = outcome.error === null ? undefined : describeError(t, outcome.error)
  const merged = mergeResults(outcome.results)
  if (!merged) {
    toast.warning(t("Common", "ImportFailedTitle"), { description: failure })
    return false
  }

  const result =
    outcome.error === null
      ? merged
      : {
          ...merged,
          failedFiles: merged.failedFiles + outcome.unsent,
          errors: failure ? [...merged.errors, failure] : merged.errors,
        }
  const notice = importResultNotice(t, result, phrase(result))
  const report = notice.tone === "success" ? toast.success : toast.warning
  report(t("Common", notice.titleKey), { description: notice.description || undefined })
  return true
}
